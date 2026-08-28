import axios from 'axios';
import { createServer } from 'node:http';
import pg from 'pg';
import { isDashboardAuthenticated, renderDashboard } from './dashboard.mjs';

const { Pool } = pg;
const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS || 180000);
const staleAfterMs = Number(process.env.STALE_AFTER_MS || 300000);
const claimTimeoutMs = Number(process.env.CLAIM_TIMEOUT_MS || 900000);
const supportedCourseIds = ['xcspeccore', 'xcspecsecurity'];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const healthPort = Number(process.env.PORT || 8080);
let scanSequence = 0;

function errorDetails(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: error.stack,
    httpStatus: error.response?.status,
    responseData: error.response?.data,
  };
}

function log(level, event, details = {}) {
  const entry = { timestamp: new Date().toISOString(), level, service: 'cleanup-worker', event, ...details };
  const output = JSON.stringify(entry);
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(output);
}

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
  log('info', 'f5xc_client_created', { courseId: id, domain: credential.domain });
  return axios.create({
    baseURL: `https://${credential.domain}`,
    headers: {
      Authorization: `APIToken ${credential.key}`,
      'Content-Type': 'application/json',
    },
    timeout: Number(process.env.F5XC_TIMEOUT_MS || 30000),
  });
}

async function claimStaleStudents(scanId) {
  const startedAt = Date.now();
  log('info', 'claim_started', { scanId, supportedCourseIds, staleAfterMs, claimTimeoutMs });
  let client;
  try {
    client = await pool.connect();
    log('info', 'database_client_acquired', { scanId });
    await client.query('BEGIN');
    log('info', 'claim_transaction_started', { scanId });
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
             jsonb_set(
               student.payload,
               '{cleanup}',
               jsonb_build_object('state', 'processing', 'claimedAt', now()::text),
               true
             ),
             '{state}',
             to_jsonb('processing'::text),
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
    log('info', 'claim_completed', {
      scanId,
      claimedCount: result.rowCount,
      deployments: result.rows.map(({ course_id: courseId, student_hash: studentHash }) => ({ courseId, studentHash })),
      durationMs: Date.now() - startedAt,
    });
    return result.rows;
  } catch (error) {
    log('error', 'claim_failed', { scanId, durationMs: Date.now() - startedAt, error: errorDetails(error) });
    if (client) {
      try {
        await client.query('ROLLBACK');
        log('info', 'claim_rollback_completed', { scanId });
      } catch (rollbackError) {
        log('error', 'claim_rollback_failed', { scanId, error: errorDetails(rollbackError) });
      }
    }
    throw error;
  } finally {
    if (client) {
      client.release();
      log('info', 'database_client_released', { scanId });
    }
  }
}

async function runF5xcOperation(action, context, request) {
  const startedAt = Date.now();
  log('info', 'f5xc_operation_started', { ...context, action });
  try {
    const response = await request();
    log('info', 'f5xc_operation_completed', {
      ...context,
      action,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error.response?.status === 404) {
      log('info', 'f5xc_resource_already_absent', { ...context, action, httpStatus: 404, durationMs: Date.now() - startedAt });
      return;
    }
    log('error', 'f5xc_operation_failed', {
      ...context,
      action,
      durationMs: Date.now() - startedAt,
      error: errorDetails(error),
    });
    throw error;
  }
}

async function deleteIfPresent(f5xc, url, data, action, context) {
  await runF5xcOperation(action, context, () => f5xc.delete(url, data ? { data } : undefined));
}

async function deactivateSiteIfPresent(f5xc, name, context) {
  await runF5xcOperation('deactivate_site', { ...context, siteName: name }, () => (
    f5xc.post(`/api/register/namespaces/system/site/${encodeURIComponent(name)}/state`, {
      namespace: 'system',
      name,
      state: 7,
    })
  ));
}

async function cleanupSpecResources(f5xc, payload, context) {
  const { siteName, tokenName } = payload.smsv2Site || {};
  if (!siteName || !tokenName) throw new Error('Student payload is missing smsv2Site.siteName or tokenName');

  log('info', 'deployment_cleanup_started', { ...context, siteName, tokenName });
  // Delete the registration access token before deactivating and deleting its SMSv2 site.
  await deleteIfPresent(f5xc, `/api/register/namespaces/system/tokens/${encodeURIComponent(tokenName)}`, {
    name: tokenName,
    namespace: 'system',
  }, 'delete_registration_token', { ...context, tokenName });
  await deactivateSiteIfPresent(f5xc, siteName, context);
  await deleteIfPresent(f5xc, `/api/config/namespaces/system/securemesh_site_v2s/${encodeURIComponent(siteName)}`, {
    name: siteName,
    namespace: 'system',
    fail_if_referred: false,
  }, 'delete_secure_mesh_site', { ...context, siteName });
  log('info', 'deployment_resources_cleaned', { ...context, siteName, tokenName });
}

async function cleanupSpecCore(f5xc, payload, context) {
  await cleanupSpecResources(f5xc, payload, context);
}

async function cleanupSpecSecurity(f5xc, payload, context) {
  await cleanupSpecResources(f5xc, payload, context);
}

const courseCleanupHandlers = {
  xcspeccore: cleanupSpecCore,
  xcspecsecurity: cleanupSpecSecurity,
};

async function setCleanupResult(row, state, error, context) {
  const startedAt = Date.now();
  const cleanup = {
    state,
    ...(state === 'cleaned' ? { cleanedAt: new Date().toISOString() } : {
      failedAt: new Date().toISOString(),
      error: String(error?.message || error).slice(0, 2000),
    }),
  };
  log('info', 'cleanup_result_update_started', { ...context, state });
  const result = await pool.query(
    `UPDATE students
     SET payload = jsonb_set(
           CASE
             WHEN $4::boolean
               THEN jsonb_set(payload #- '{smsv2Site,token}', '{cleanup}', $3::jsonb, true)
             ELSE jsonb_set(payload, '{cleanup}', $3::jsonb, true)
           END,
           '{state}',
           to_jsonb($5::text),
           true
         ),
         updated_at = now()
     WHERE course_id = $1 AND student_hash = $2`,
    [row.course_id, row.student_hash, JSON.stringify(cleanup), state === 'cleaned', state],
  );
  log('info', 'cleanup_result_update_completed', {
    ...context,
    state,
    updatedCount: result.rowCount,
    durationMs: Date.now() - startedAt,
  });
}

async function scan() {
  scanInProgress = true;
  const scanId = `${Date.now()}-${++scanSequence}`;
  const startedAt = Date.now();
  log('info', 'scan_started', { scanId });
  const rows = await claimStaleStudents(scanId);
  let cleanedCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    const context = {
      scanId,
      courseId: row.course_id,
      studentHash: row.student_hash,
      deploymentId: row.payload.deploymentId,
    };
    log('info', 'deployment_processing_started', context);
    try {
      const cleanupCourse = courseCleanupHandlers[row.course_id];
      if (!cleanupCourse) throw new Error(`No cleanup handler configured for ${row.course_id}`);
      const f5xc = createF5xcClient(row.course_id);
      await cleanupCourse(f5xc, row.payload, context);
      await setCleanupResult(row, 'cleaned', undefined, context);
      cleanedCount += 1;
      log('info', 'deployment_processing_completed', context);
    } catch (error) {
      failedCount += 1;
      log('error', 'deployment_processing_failed', { ...context, error: errorDetails(error) });
      try {
        await setCleanupResult(row, 'failed', error, context);
      } catch (resultError) {
        log('error', 'cleanup_failure_result_update_failed', { ...context, error: errorDetails(resultError) });
      }
    }
  }
  log('info', 'scan_completed', {
    scanId,
    claimedCount: rows.length,
    cleanedCount,
    failedCount,
    durationMs: Date.now() - startedAt,
  });
}

let workerEnabled = true;
let terminating = false;
let scanInProgress = false;
let lastScanCompletedAt;
let wakeScheduler;

function wakeWorker() {
  wakeScheduler?.();
  wakeScheduler = undefined;
}

function waitForWorker(timeoutMs) {
  return new Promise((resolve) => {
    const timer = timeoutMs === undefined ? undefined : setTimeout(finish, timeoutMs);
    function finish() {
      if (timer) clearTimeout(timer);
      if (wakeScheduler === finish) wakeScheduler = undefined;
      resolve();
    }
    wakeScheduler = finish;
  });
}

function sendDashboardAuthentication(response) {
  response.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="F5XC Lab Monitor", charset="UTF-8"',
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end('Authentication required');
}

function redirectToDashboard(response) {
  response.writeHead(303, { Location: '/dashboard', 'Cache-Control': 'no-store' });
  response.end();
}

const healthServer = createServer((request, response) => {
  const startedAt = Date.now();
  const rawTarget = request.url || '/';
  const requestContext = {
    method: request.method,
    path: rawTarget,
    remoteAddress: request.socket.remoteAddress,
  };
  response.once('finish', () => log('info', 'http_request_completed', {
    ...requestContext,
    httpStatus: response.statusCode,
    durationMs: Date.now() - startedAt,
  }));

  let requestUrl;
  try {
    // Lightsail health checks may send "//"; normalize it as an origin-form path
    // instead of allowing URL to interpret it as a hostname-less network URL.
    const normalizedTarget = rawTarget.replace(/^\/{2,}/, '/');
    requestUrl = new URL(normalizedTarget, 'http://localhost');
    requestContext.path = requestUrl.pathname;
  } catch (error) {
    log('warn', 'invalid_http_request_target', {
      ...requestContext,
      error: errorDetails(error),
    });
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end('{"error":"invalid request target"}');
    return;
  }

  if (requestUrl.pathname.startsWith('/dashboard') && !isDashboardAuthenticated(request)) {
    log('warn', 'dashboard_authentication_failed', requestContext);
    sendDashboardAuthentication(response);
  } else if (request.method === 'GET' && requestUrl.pathname === '/dashboard') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(renderDashboard({
      enabled: workerEnabled,
      scanInProgress,
      lastScanCompletedAt,
      scanIntervalMs,
    }));
  } else if (request.method === 'POST' && requestUrl.pathname === '/dashboard/start') {
    const changed = !workerEnabled;
    workerEnabled = true;
    wakeWorker();
    log('info', 'worker_enabled_from_dashboard', { ...requestContext, changed });
    redirectToDashboard(response);
  } else if (request.method === 'POST' && requestUrl.pathname === '/dashboard/stop') {
    const changed = workerEnabled;
    workerEnabled = false;
    wakeWorker();
    log('info', 'worker_disabled_from_dashboard', { ...requestContext, changed, scanInProgress });
    redirectToDashboard(response);
  } else if (request.method === 'GET' && requestUrl.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', worker: workerEnabled ? 'running' : 'stopped' }));
  } else {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end('{"error":"not found"}');
  }
});
healthServer.on('error', (error) => log('error', 'health_server_error', { error: errorDetails(error) }));
healthServer.listen(healthPort, '0.0.0.0', () => log('info', 'health_server_started', { port: healthPort }));

const stop = (signal) => {
  log('info', 'shutdown_requested', { signal });
  terminating = true;
  wakeWorker();
};
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));

log('info', 'worker_started', {
  scanIntervalMs,
  staleAfterMs,
  claimTimeoutMs,
  healthPort,
  poolMax: pool.options.max,
  supportedCourseIds,
});

try {
  while (!terminating) {
    if (!workerEnabled) {
      log('info', 'worker_paused');
      await waitForWorker();
      continue;
    }

    try {
      await scan();
    } catch (error) {
      log('error', 'scan_failed', { error: errorDetails(error) });
    } finally {
      scanInProgress = false;
      lastScanCompletedAt = new Date().toISOString();
    }

    if (!terminating && workerEnabled) {
      log('info', 'scan_sleep_started', { durationMs: scanIntervalMs });
      await waitForWorker(scanIntervalMs);
      log('info', 'scan_sleep_completed', { durationMs: scanIntervalMs });
    }
  }
} finally {
  log('info', 'worker_shutdown_started');
  await new Promise((resolve) => healthServer.close(resolve));
  log('info', 'health_server_stopped');
  await pool.end();
  log('info', 'database_pool_closed');
  log('info', 'worker_stopped');
}
