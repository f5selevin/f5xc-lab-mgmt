const metadataUrl = process.env.METADATA_URL || 'http://localhost:5123/metadata';
const apiUrl = process.env.API_URL;
const intervalMs = Number(process.env.PING_INTERVAL_MS || 60000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!apiUrl) throw new Error('API_URL is required');

async function getMetadata() {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Metadata returned HTTP ${response.status}`);
      const metadata = await response.json();
      if (metadata.dep_id && metadata.email && metadata.petname) return metadata;
      lastError = new Error('Metadata is missing dep_id, email, or petname');
    } catch (error) {
      lastError = error;
    }

    console.warn(`Metadata attempt ${attempt}/10 failed: ${lastError.message}`);
    if (attempt < 10) await delay(10000);
  }
  throw lastError;
}

async function ping() {
  const metadata = await getMetadata();
  const response = await fetch(new URL('/deployment/ping', apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deploymentId: metadata.dep_id,
      email: metadata.email,
      namespace: metadata.petname,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Ping returned HTTP ${response.status}: ${body}`);
  console.log(`Deployment ${metadata.dep_id} seen at ${new Date().toISOString()}`);
}

while (true) {
  try {
    await ping();
  } catch (error) {
    console.error(`Deployment ping failed: ${error.message}`);
  }
  await delay(intervalMs);
}
