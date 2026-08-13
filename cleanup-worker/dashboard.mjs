import { timingSafeEqual } from 'node:crypto';

const dashboardPassword = process.env.DASHBOARD_PASSWORD || 'xcspeclabs';

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isDashboardAuthenticated(request) {
  const authorization = request.headers.authorization || '';
  let password = '';

  if (authorization.startsWith('Basic ')) {
    try {
      const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const separator = credentials.indexOf(':');
      if (separator >= 0) password = credentials.slice(separator + 1);
    } catch {
      password = '';
    }
  }

  return safeEqual(password, dashboardPassword);
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function renderDashboard(status) {
  const state = status.enabled ? 'Running' : 'Stopped';
  const stateKind = status.enabled ? 'running' : 'stopped';
  const activity = status.scanInProgress ? 'A cleanup scan is currently in progress.'
    : status.enabled ? 'Waiting for the next cleanup scan.' : 'Automatic cleanup is paused.';
  const lastScan = status.lastScanCompletedAt || 'Never';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>Cleanup Worker</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#141b2d;--border:#2a3550;--text:#eef2ff;--muted:#9ca9c7;--green:#34d399;--red:#fb7185;--blue:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px system-ui,sans-serif}header{padding:24px 28px;border-bottom:1px solid var(--border)}h1{margin:0 0 6px;font-size:24px}header p,p{color:var(--muted)}main{max-width:760px;padding:28px}.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:22px}.status{display:flex;align-items:center;gap:10px;margin-bottom:18px}.badge{padding:5px 10px;border-radius:999px;font-weight:700}.running{background:#064e3b;color:#a7f3d0}.stopped{background:#881337;color:#fecdd3}.details{display:grid;grid-template-columns:180px 1fr;gap:10px;margin:22px 0}.details dt{color:var(--muted)}.details dd{margin:0;font-family:ui-monospace,monospace}.actions{display:flex;gap:12px;margin-top:22px}form{margin:0}button{border:0;border-radius:8px;padding:11px 18px;color:white;font:inherit;font-weight:700;cursor:pointer}.start{background:#047857}.stop{background:#be123c}button:disabled{cursor:not-allowed;opacity:.45}@media(max-width:600px){main,header{padding:18px}.details{grid-template-columns:1fr}.actions{flex-direction:column}button{width:100%}}
</style></head><body><header><h1>F5XC Cleanup Worker</h1><p>Authenticated worker control panel · Refreshes every 10 seconds</p></header>
<main><section class="panel"><div class="status"><strong>Worker state</strong><span class="badge ${stateKind}">${state}</span></div>
<p>${escapeHtml(activity)}</p><dl class="details"><dt>Scan in progress</dt><dd>${status.scanInProgress ? 'Yes' : 'No'}</dd><dt>Last scan completed</dt><dd>${escapeHtml(lastScan)}</dd><dt>Scan interval</dt><dd>${escapeHtml(status.scanIntervalMs)} ms</dd><dt>Server time</dt><dd>${escapeHtml(new Date().toISOString())}</dd></dl>
<div class="actions"><form method="post" action="/dashboard/start"><button class="start" type="submit" ${status.enabled ? 'disabled' : ''}>Start cleanup worker</button></form><form method="post" action="/dashboard/stop"><button class="stop" type="submit" ${status.enabled ? '' : 'disabled'}>Stop cleanup worker</button></form></div>
</section></main></body></html>`;
}
