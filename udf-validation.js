import dns from 'node:dns';

const normalizeIp = (ip = '') => ip.replace(/^::ffff:/, '');

export async function validateUdfRequest({ udfHost, ip }) {
    if (!udfHost || !ip) return false;

    const addresses = await dns.promises.resolve4(udfHost);
    return addresses.includes(normalizeIp(ip));
}
