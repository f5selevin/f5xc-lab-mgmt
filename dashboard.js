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

function latestDate(student) {
    return student.lastSeen || student.updatedAt || student.createdAt;
}

function validDateInput(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    return Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ? value : '';
}

function pageUrl(page, { from, to, pageSize }) {
    const parameters = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (from) parameters.set('from', from);
    if (to) parameters.set('to', to);
    return `/dashboard?${parameters}`;
}

function filterByDate(students, from, to) {
    const fromTime = from ? Date.parse(`${from}T00:00:00.000Z`) : -Infinity;
    const toTime = to ? Date.parse(`${to}T23:59:59.999Z`) : Infinity;
    return students.filter((student) => {
        const timestamp = new Date(latestDate(student)).getTime();
        return Number.isFinite(timestamp) && timestamp >= fromTime && timestamp <= toTime;
    });
}

function itemRows(items, now) {
    return items.map((student) => {
        const pingAge = age(student.lastSeen, now);
        const liveness = pingAge.stale ? badge('stale', 'danger') : badge('online', 'success');
        const cleanupKind = student.cleanupState === 'cleaned' ? 'success'
            : student.cleanupState === 'failed' ? 'danger'
                : student.cleanupState === 'processing' ? 'warning' : '';
        const cleanupDetails = student.cleanupError
            ? `<details class="error"><summary>Error</summary><pre>${escapeHtml(student.cleanupError)}</pre></details>` : '';
        return `<tr><td>${escapeHtml(student.namespace || '—')}</td>
            <td class="mono">${escapeHtml(student.deploymentId || '—')}</td>
            <td>${badge(student.studentState || 'unknown')}</td>
            <td>${liveness}<div>${escapeHtml(pingAge.label)} ago</div><small>${escapeHtml(formatDate(student.lastSeen))}</small></td>
            <td>${badge(student.cleanupState || 'not started', cleanupKind)}${cleanupDetails}</td>
            <td class="mono">${escapeHtml(student.siteName || '—')}</td>
            <td><small>${escapeHtml(formatDate(student.createdAt))}</small></td>
            <td><small>${escapeHtml(formatDate(student.updatedAt))}</small></td></tr>`;
    }).join('');
}

export function renderDashboardItems(students, query = {}) {
    const items = filterByDate(students, validDateInput(query.from), validDateInput(query.to));
    if (!items.length) return '<div class="empty">No items found for this date range</div>';
    return `<div class="items"><table><thead><tr><th>Namespace</th><th>Deployment</th><th>Student state</th><th>Last ping</th><th>Cleanup</th><th>Resource</th><th>Created</th><th>DB updated</th></tr></thead><tbody>${itemRows(items, Date.now())}</tbody></table></div>`;
}

export function renderDashboard(students, query = {}) {
    const now = Date.now();
    const from = validDateInput(query.from);
    const to = validDateInput(query.to);
    const filtered = filterByDate(students, from, to);
    const active = filtered.filter((student) => !age(student.lastSeen, now).stale && student.cleanupState !== 'cleaned').length;
    const stale = filtered.filter((student) => age(student.lastSeen, now).stale && !student.cleanupState).length;
    const processing = filtered.filter((student) => student.cleanupState === 'processing').length;
    const failed = filtered.filter((student) => student.cleanupState === 'failed').length;
    const cleaned = filtered.filter((student) => student.cleanupState === 'cleaned').length;
    const grouped = new Map();

    for (const student of filtered) {
        const name = student.email || 'Unknown user';
        const key = `${name.toLowerCase()}\u0000${student.courseId}`;
        if (!grouped.has(key)) grouped.set(key, { name, email: student.email || '', courseId: student.courseId, items: [] });
        grouped.get(key).items.push(student);
    }

    const groups = [...grouped.values()].map((group) => ({
        ...group,
        items: group.items.sort((left, right) => new Date(latestDate(right)) - new Date(latestDate(left))),
    })).sort((left, right) => new Date(latestDate(right.items[0])) - new Date(latestDate(left.items[0])));
    const requestedPageSize = Number.parseInt(query.pageSize, 10);
    const pageSize = [10, 20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20;
    const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
    const requestedPage = Number.parseInt(query.page, 10);
    const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), pageCount);
    const visibleGroups = groups.slice((page - 1) * pageSize, page * pageSize);
    const rows = visibleGroups.map((group) => `<tr class="group-row"><td><button type="button" class="group-toggle" data-email="${escapeHtml(group.email)}" data-course="${escapeHtml(group.courseId)}" aria-expanded="false"><span class="arrow">▶</span>${escapeHtml(group.name)}</button></td><td>${escapeHtml(group.courseId)}</td><td><strong>${group.items.length}</strong></td><td><small>${escapeHtml(formatDate(latestDate(group.items[0])))}</small></td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">No items found for this date range</td></tr>';
    const previous = page > 1 ? `<a href="${escapeHtml(pageUrl(page - 1, { from, to, pageSize }))}">Previous</a>` : '<span>Previous</span>';
    const next = page < pageCount ? `<a href="${escapeHtml(pageUrl(page + 1, { from, to, pageSize }))}">Next</a>` : '<span>Next</span>';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>F5XC Lab Monitor</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#141b2d;--border:#2a3550;--text:#eef2ff;--muted:#9ca9c7;--blue:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}header,main{padding:24px 28px}header{border-bottom:1px solid var(--border)}h1{margin:0 0 6px;font-size:24px}header p{margin:0;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:12px;margin-bottom:20px}.card,.filters{background:var(--panel);border:1px solid var(--border);border-radius:10px}.card{padding:16px}.card strong{display:block;font-size:26px}.card span,small{color:var(--muted)}.filters{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:14px}.filters label{display:grid;gap:5px;color:var(--muted)}input,select,button,.filters a,.pager a{border:1px solid var(--border);border-radius:6px;background:#1b253b;color:var(--text);padding:8px 10px;font:inherit;text-decoration:none}button{cursor:pointer;background:#1d4ed8}.table-wrap,.items{overflow:auto}.table-wrap{border:1px solid var(--border);border-radius:10px}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--border);vertical-align:top;white-space:nowrap}th{background:#1b253b;color:var(--muted);font-size:12px;text-transform:uppercase}tr:last-child td{border-bottom:0}.group-row>td:first-child{width:55%}.group-toggle{border:0;background:transparent;color:var(--blue);padding:0;font-weight:600}.arrow{display:inline-block;width:20px}.group-toggle[aria-expanded="true"] .arrow{transform:rotate(90deg)}.detail-row>td{padding:0;background:#0f172a}.detail-content{padding:12px}.detail-row[hidden]{display:none}.items{width:100%}.items table{border:1px solid var(--border)}.items th,.items td{padding:9px}.badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#334155;margin-bottom:4px}.success{background:#064e3b;color:#a7f3d0}.danger{background:#881337;color:#fecdd3}.warning{background:#713f12;color:#fde68a}.mono{font-family:ui-monospace,monospace;font-size:12px}.error{max-width:260px;white-space:normal;color:#fb7185}pre{white-space:pre-wrap}.empty{text-align:center;padding:40px;color:var(--muted)}.pager{display:flex;justify-content:space-between;align-items:center;margin-top:14px}.pager span{color:var(--muted)}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}main,header{padding:18px}}
</style></head><body><header><h1>F5XC Lab Monitor</h1><p>Server time: ${escapeHtml(new Date(now).toISOString())} · Cleanup threshold: 5 minutes</p></header>
<main><section class="cards"><div class="card"><strong>${filtered.length}</strong><span>Items</span></div><div class="card"><strong>${active}</strong><span>Online</span></div><div class="card"><strong>${stale}</strong><span>Stale, waiting</span></div><div class="card"><strong>${processing}</strong><span>Cleaning</span></div><div class="card"><strong>${failed}</strong><span>Failed</span></div><div class="card"><strong>${cleaned}</strong><span>Cleaned</span></div></section>
<form class="filters" method="get" action="/dashboard"><label>From (UTC)<input type="date" name="from" value="${escapeHtml(from)}"></label><label>To (UTC)<input type="date" name="to" value="${escapeHtml(to)}"></label><label>Groups per page<select name="pageSize">${[10, 20, 50, 100].map((size) => `<option value="${size}"${size === pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select></label><button type="submit">Apply filters</button><a href="/dashboard">Clear</a></form>
<div class="table-wrap"><table class="group-table"><thead><tr><th>Name</th><th>Course</th><th>Items</th><th>Latest date</th></tr></thead><tbody>${rows}</tbody></table></div>
<nav class="pager" aria-label="Pagination">${previous}<span>Page ${page} of ${pageCount} · ${groups.length} groups</span>${next}</nav></main>
<script>
document.querySelector('.group-table tbody').addEventListener('click', async (event) => {
    const button = event.target.closest('.group-toggle');
    if (!button) return;
    const groupRow = button.closest('.group-row');
    let detailRow = groupRow.nextElementSibling;
    if (detailRow?.classList.contains('detail-row')) {
        const opening = detailRow.hidden;
        detailRow.hidden = !opening;
        button.setAttribute('aria-expanded', String(opening));
        return;
    }
    detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'detail-content';
    cell.textContent = 'Loading items…';
    detailRow.append(cell);
    groupRow.after(detailRow);
    button.setAttribute('aria-expanded', 'true');
    const parameters = new URLSearchParams({ email: button.dataset.email, courseId: button.dataset.course });
    const current = new URLSearchParams(window.location.search);
    if (current.has('from')) parameters.set('from', current.get('from'));
    if (current.has('to')) parameters.set('to', current.get('to'));
    try {
        const response = await fetch('/dashboard/items?' + parameters, {
            credentials: 'same-origin',
            headers: { Accept: 'text/html' },
        });
        if (!response.ok) throw new Error('Request failed with status ' + response.status);
        cell.innerHTML = await response.text();
    } catch (error) {
        cell.textContent = 'Unable to load items. ' + error.message;
    }
});
</script></body></html>`;
}
