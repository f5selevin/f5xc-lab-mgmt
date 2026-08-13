import axios from 'axios';
import { createServer } from 'node:http';
import pg from 'pg';

const { Pool } = pg;
const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS || 180000);
const staleAfterMs = Number(process.env.STALE_AFTER_MS || 300000);
const claimTimeoutMs = Number(process.env.CLAIM_TIMEOUT_MS || 900000);
const supportedCourseIds = ['xcspeccore'];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const healthPort = Number(process.env.PORT || 8080);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.F5XC_CREDENTIALS_BASE64) throw new Error('F5XC_CREDENTIALS_BASE64 is required');
if (![scanIntervalMs, staleAfterMs, claimTimeoutMs].every(Number.isFinite)) {
  throw new Error('Worker intervals must be valid numbers');
}

let credentials;
try {
  credentials = JSON.parse(Buffer.from(process.env.F5XC_CREDENTIALS_BASE64, 'base64').toString('utf8'));
} catch (error) {
  throw new Error('F5XC_CREDENTIALS_BASE64 must be base64-encoded valid JSON', { cause: error });
}

function loadCourseCredential(id) {
  const credential = credentials[id];
  if (!credential) throw new Error(`F5XC_CREDENTIALS_BASE64 must contain a ${id} credential`);

  const domain = (typeof credential === 'string'
    ? process.env.F5XC_DOMAIN
    : credential.domain || credential.address || process.env.F5XC_DOMAIN
  )?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const key = typeof credential === 'string'
    ? credential
    : credential.key || credential.apiKey || credential.apikey;

  if (!domain || !key) throw new Error(`F5XC credential for ${id} requires both an XC domain and API key`);
  return { domain, key };
}

const sslMode = process.env.PGSSLMODE || 'require';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' },
  max: Number(process.env.PGPOOL_MAX || 3),
});
function createF5xcClient(id) {
  const credential = loadCourseCredential(id);
  return axios.create({
    baseURL: `https://${credential.domain}`,
    headers: {
      Authorization: `APIToken ${credential.key}`,
      'Content-Type': 'application/json',
    },
    timeout: Number(process.env.F5XC_TIMEOUT_MS || 30000),
  });
}

async function claimStaleStudents() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `WITH candidates AS (
         SELECT course_id, student_hash
         FROM students
         WHERE course_id = ANY($1::text[])
           AND payload ? 'lastSeen'
           AND (payload->>'lastSeen')::timestamptz < now() - ($2::bigint * interval '1 millisecond')
           AND (
             payload->'cleanup' IS NULL
             OR (
               payload->'cleanup'->>'state' = 'processing'
               AND (payload->'cleanup'->>'claimedAt')::timestamptz < now() - ($3::bigint * interval '1 millisecond')
             )
           )
         ORDER BY (payload->>'lastSeen')::timestamptz
         LIMIT 20
         FOR UPDATE SKIP LOCKED
       )
       UPDATE students AS student
       SET payload = jsonb_set(
             student.payload,
             '{cleanup}',
             jsonb_build_object('state', 'processing', 'claimedAt', now()::text),
             true
           ),
           updated_at = now()
       FROM candidates
       WHERE student.course_id = candidates.course_id
         AND student.student_hash = candidates.student_hash
       RETURNING student.course_id, student.student_hash, student.payload`,
      [supportedCourseIds, staleAfterMs, claimTimeoutMs],
    );
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ignoreMissing(request) {
  try {
    await request();
  } catch (error) {
    if (error.response?.status !== 404) throw error;
  }
}

async function deleteIfPresent(f5xc, url, data) {
  await ignoreMissing(() => f5xc.delete(url, data ? { data } : undefined));
}

async function deactivateSiteIfPresent(f5xc, name) {
  await ignoreMissing(() => f5xc.post(`/api/register/namespaces/system/site/${encodeURIComponent(name)}/state`, {
    namespace: 'system',
    name,
    state: 7,
  }));
}

async function cleanupSpecCore(f5xc, payload) {
  const { siteName, tokenName } = payload.smsv2Site || {};
  if (!siteName || !tokenName) throw new Error('Student payload is missing smsv2Site.siteName or tokenName');

  // Delete the registration access token before deactivating and deleting its SMSv2 site.
  await deleteIfPresent(f5xc, `/api/register/namespaces/system/tokens/${encodeURIComponent(tokenName)}`, {
    name: tokenName,
    namespace: 'system',
  });
  await deactivateSiteIfPresent(f5xc, siteName);
  await deleteIfPresent(f5xc, `/api/config/namespaces/system/securemesh_site_v2s/${encodeURIComponent(siteName)}`, {
    name: siteName,
    namespace: 'system',
    fail_if_referred: false,
  });
}

async function setCleanupResult(row, state, error) {
  const cleanup = {
    state,
    ...(state === 'cleaned' ? { cleanedAt: new Date().toISOString() } : {
      failedAt: new Date().toISOString(),
      error: String(error?.message || error).slice(0, 2000),
    }),
  };
  await pool.query(
    `UPDATE students
     SET payload = CASE
           WHEN $4::boolean
             THEN jsonb_set(payload #- '{smsv2Site,token}', '{cleanup}', $3::jsonb, true)
           ELSE jsonb_set(payload, '{cleanup}', $3::jsonb, true)
         END,
         updated_at = now()
     WHERE course_id = $1 AND student_hash = $2`,
    [row.course_id, row.student_hash, JSON.stringify(cleanup), state === 'cleaned'],
  );
}

async function scan() {
  const rows = await claimStaleStudents();
  console.log(`Found ${rows.length} stale supported deployment(s)`);
  for (const row of rows) {
    try {
      const f5xc = createF5xcClient(row.course_id);
      await cleanupSpecCore(f5xc, row.payload);
      await setCleanupResult(row, 'cleaned');
      console.log(`Cleaned ${row.course_id}/${row.student_hash} deployment ${row.payload.deploymentId}`);
    } catch (error) {
      await setCleanupResult(row, 'failed', error);
      console.error(`Cleanup failed for ${row.course_id}/${row.student_hash}:`, error.response?.data || error.message);
    }
  }
}

const healthServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"status":"ok"}');
});
healthServer.listen(healthPort, '0.0.0.0', () => console.log(`Health endpoint listening on ${healthPort}`));

let stopping = false;
const stop = (signal) => {
  console.log(`${signal} received; stopping after the current scan`);
  stopping = true;
};
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));

try {
  while (!stopping) {
    try {
      await scan();
    } catch (error) {
      console.error('Cleanup scan failed:', error);
    }
    if (!stopping) await delay(scanIntervalMs);
  }
} finally {
  await new Promise((resolve) => healthServer.close(resolve));
  await pool.end();
}
