import { timingSafeEqual } from 'node:crypto';

const dashboardPassword = process.env.DASHBOARD_PASSWORD || 'xcspeclabs';

function safeEqual(actual, expected) {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function requireDashboardPassword(request, reply, done) {
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

    if (!safeEqual(password, dashboardPassword)) {
        reply.header('WWW-Authenticate', 'Basic realm="F5XC Lab Monitor", charset="UTF-8"');
        reply.header('Cache-Control', 'no-store');
        reply.code(401).send('Authentication required');
        return;
    }
    done();
}

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const formatDate = (value) => value ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';

function age(lastSeen, now) {
    if (!lastSeen) return { label: 'Never', stale: true };
    const milliseconds = now - new Date(lastSeen).getTime();
    if (!Number.isFinite(milliseconds)) return { label: 'Invalid', stale: true };
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    if (seconds < 60) return { label: `${seconds}s`, stale: false };
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return { label: `${minutes}m ${seconds % 60}s`, stale: minutes >= 5 };
    return { label: `${Math.floor(minutes / 60)}h ${minutes % 60}m`, stale: true };
}

function badge(value, kind = '') {
    return `<span class="badge ${escapeHtml(kind)}">${escapeHtml(value || 'none')}</span>`;
}

export function renderDashboard(students) {
    const now = Date.now();
    const active = students.filter((student) => !age(student.lastSeen, now).stale && student.cleanupState !== 'cleaned').length;
    const stale = students.filter((student) => age(student.lastSeen, now).stale && !student.cleanupState).length;
    const processing = students.filter((student) => student.cleanupState === 'processing').length;
    const failed = students.filter((student) => student.cleanupState === 'failed').length;
    const cleaned = students.filter((student) => student.cleanupState === 'cleaned').length;

    const rows = students.map((student) => {
        const pingAge = age(student.lastSeen, now);
        const liveness = pingAge.stale ? badge('stale', 'danger') : badge('online', 'success');
        const cleanupKind = student.cleanupState === 'cleaned' ? 'success'
            : student.cleanupState === 'failed' ? 'danger'
                : student.cleanupState === 'processing' ? 'warning' : '';
        const cleanupDetails = student.cleanupError
            ? `<details><summary>Error</summary><pre>${escapeHtml(student.cleanupError)}</pre></details>` : '';
        return `<tr>
            <td>${escapeHtml(student.email || '—')}</td>
            <td>${escapeHtml(student.courseId)}</td>
            <td>${escapeHtml(student.namespace || '—')}</td>
            <td class="mono">${escapeHtml(student.deploymentId || '—')}</td>
            <td>${badge(student.studentState || 'unknown')}</td>
            <td>${liveness}<div>${escapeHtml(pingAge.label)} ago</div><small>${escapeHtml(formatDate(student.lastSeen))}</small></td>
            <td>${badge(student.cleanupState || 'not started', cleanupKind)}${cleanupDetails}</td>
            <td class="mono">${escapeHtml(student.siteName || '—')}</td>
            <td><small>${escapeHtml(formatDate(student.createdAt))}</small></td>
            <td><small>${escapeHtml(formatDate(student.updatedAt))}</small></td>
        </tr>`;
    }).join('') || '<tr><td colspan="10" class="empty">No students found</td></tr>';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>F5XC Lab Monitor</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#141b2d;--border:#2a3550;--text:#eef2ff;--muted:#9ca9c7;--blue:#60a5fa;--green:#34d399;--red:#fb7185;--yellow:#fbbf24}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}header{padding:24px 28px;border-bottom:1px solid var(--border)}h1{margin:0 0 6px;font-size:24px}header p{margin:0;color:var(--muted)}main{padding:24px 28px}.cards{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:12px;margin-bottom:20px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px}.card strong{display:block;font-size:26px}.card span,small{color:var(--muted)}.table-wrap{overflow:auto;border:1px solid var(--border);border-radius:10px}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--border);vertical-align:top;white-space:nowrap}th{position:sticky;top:0;background:#1b253b;color:var(--muted);font-size:12px;text-transform:uppercase}tr:last-child td{border-bottom:0}.badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#334155;margin-bottom:4px}.success{background:#064e3b;color:#a7f3d0}.danger{background:#881337;color:#fecdd3}.warning{background:#713f12;color:#fde68a}.mono{font-family:ui-monospace,monospace;font-size:12px}details{max-width:260px;white-space:normal;color:var(--red)}pre{white-space:pre-wrap}.empty{text-align:center;padding:40px;color:var(--muted)}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}main,header{padding:18px}}
</style></head><body><header><h1>F5XC Lab Monitor</h1><p>Server time: ${escapeHtml(new Date(now).toISOString())} · Auto-refreshes every 30 seconds · Cleanup threshold: 5 minutes</p></header>
<main><section class="cards"><div class="card"><strong>${students.length}</strong><span>Total</span></div><div class="card"><strong>${active}</strong><span>Online</span></div><div class="card"><strong>${stale}</strong><span>Stale, waiting</span></div><div class="card"><strong>${processing}</strong><span>Cleaning</span></div><div class="card"><strong>${failed}</strong><span>Failed</span></div><div class="card"><strong>${cleaned}</strong><span>Cleaned</span></div></section>
<div class="table-wrap"><table><thead><tr><th>User</th><th>Course</th><th>Namespace</th><th>Deployment</th><th>Student state</th><th>Last ping</th><th>Cleanup</th><th>Resource</th><th>Created</th><th>DB updated</th></tr></thead><tbody>${rows}</tbody></table></div></main></body></html>`;
}
