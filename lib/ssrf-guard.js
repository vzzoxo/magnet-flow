'use strict';

const dns = require('dns').promises;
const net = require('net');

/**
 * Is the given IP address in a private / loopback / link-local / reserved
 * range that should never be reachable via a user-supplied download URL?
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIp(ip) {
  if (!ip) return true;
  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254)
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);

  const type = net.isIP(ip);
  if (type === 4) {
    const o = ip.split('.').map(Number);
    if (o[0] === 0) return true;                                  // 0.0.0.0/8
    if (o[0] === 10) return true;                                 // 10/8 private
    if (o[0] === 127) return true;                                // loopback
    if (o[0] === 169 && o[1] === 254) return true;                // link-local + cloud metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;    // 172.16/12 private
    if (o[0] === 192 && o[1] === 168) return true;                // 192.168/16 private
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;   // 100.64/10 CGNAT
    if (o[0] >= 224) return true;                                 // multicast/reserved
    return false;
  }
  if (type === 6) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;                   // loopback / unspecified
    if (l.startsWith('fc') || l.startsWith('fd')) return true;    // fc00::/7 unique-local
    if (l.startsWith('fe80')) return true;                        // link-local
    return false;
  }
  return true; // not a valid IP literal — treat as unsafe
}

/**
 * Validate a user-supplied download URL for SSRF safety.
 * Only http/https are inspected (magnet/BT are peer-to-peer, not a server-side
 * fetch of an attacker-chosen host). Resolves the hostname and rejects if it
 * maps to any private/internal address.
 *
 * @param {string} rawUrl
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function validateDownloadUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }

  // Non-HTTP schemes (magnet:) are not a host-fetch SSRF vector here.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: true };
  }

  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  if (/^localhost$/i.test(host) || /\.localhost$/i.test(host)) {
    return { ok: false, error: 'Blocked: internal address is not allowed' };
  }

  if (net.isIP(host)) {
    return isPrivateIp(host)
      ? { ok: false, error: 'Blocked: internal address is not allowed' }
      : { ok: true };
  }

  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    return { ok: false, error: 'Cannot resolve host' };
  }
  if (addresses.some((a) => isPrivateIp(a.address))) {
    return { ok: false, error: 'Blocked: host resolves to an internal address' };
  }
  return { ok: true };
}

module.exports = { isPrivateIp, validateDownloadUrl };
