const metadataUrl = process.env.METADATA_URL || 'http://localhost:5123/metadata';
const deploymentMetadataUrl = process.env.DEPLOYMENT_METADATA_URL || 'http://metadata.udf/deployment';
const apiUrl = process.env.API_URL;
const intervalMs = Number(process.env.PING_INTERVAL_MS || 60000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!apiUrl) throw new Error('API_URL is required');

console.log('Starting deployment ping client', {
  version: '2',
  apiUrl,
  metadataUrl,
  deploymentMetadataUrl,
  intervalMs,
});

async function getMetadata() {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const [localResponse, deploymentResponse] = await Promise.all([
        fetch(metadataUrl, { signal: AbortSignal.timeout(5000) }),
        fetch(deploymentMetadataUrl, { signal: AbortSignal.timeout(5000) }),
      ]);
      if (!localResponse.ok) throw new Error(`Local metadata returned HTTP ${localResponse.status}`);
      if (!deploymentResponse.ok) throw new Error(`Deployment metadata returned HTTP ${deploymentResponse.status}`);

      const [metadata, deploymentMetadata] = await Promise.all([
        localResponse.json(),
        deploymentResponse.json(),
      ]);
      if (metadata.dep_id && metadata.email && metadata.petname && deploymentMetadata?.deployment?.host) {
        return { ...metadata, udfHost: deploymentMetadata.deployment.host };
      }
      lastError = new Error('Metadata is missing dep_id, email, petname, or deployment.host');
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
  const url = new URL('/deployment/ping', apiUrl);
  const payload = {
    deploymentId: metadata.dep_id,
    email: metadata.email,
    namespace: metadata.petname,
    udfHost: metadata.udfHost,
  };
  const missingFields = ['deploymentId', 'namespace', 'udfHost'].filter((field) => !payload[field]);
  if (missingFields.length) {
    throw new Error(`Not sending ping because fields are missing: ${missingFields.join(', ')}`);
  }

  const startedAt = Date.now();
  console.log('Sending deployment ping', { url: url.toString(), payload });
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  const body = await response.text();
  const responseDetails = {
    status: response.status,
    durationMs: Date.now() - startedAt,
    body,
  };
  if (!response.ok) {
    console.error('Deployment ping rejected', responseDetails);
    throw new Error(`Ping returned HTTP ${response.status}: ${body}`);
  }
  console.log('Deployment ping accepted', responseDetails);
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
