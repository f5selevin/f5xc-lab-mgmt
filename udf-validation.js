import dns from 'node:dns';

const normalizeIp = (ip = '') => ip.replace(/^::ffff:/, '');

export async function validateUdfRequest({ udfHost, ip, log, allowIpMismatch = false }) {
    const normalizedIp = normalizeIp(ip);

    if (!udfHost || (!ip && !allowIpMismatch)) {
        log?.warn({
            operation: 'validateUdfRequest',
            udfHost,
            ip,
            hasUdfHost: Boolean(udfHost),
            hasIp: Boolean(ip),
            allowIpMismatch,
            reason: !udfHost ? 'Missing udfHost' : 'Missing request IP'
        });
        return false;
    }

    const addresses = await dns.promises.resolve4(udfHost);
    const ipMatches = addresses.includes(normalizedIp);
    const valid = ipMatches || allowIpMismatch;
    const context = {
        operation: 'validateUdfRequest',
        udfHost,
        ip,
        normalizedIp,
        addresses,
        ipMatches,
        allowIpMismatch,
        valid
    };
    if (ipMatches) log?.info(context);
    else log?.warn({ ...context, reason: allowIpMismatch ? 'IP mismatch allowed for compatibility' : 'IP mismatch' });
    return valid;
}
