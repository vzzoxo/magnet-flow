'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPrivateIp, validateDownloadUrl } = require('../lib/ssrf-guard');

test('isPrivateIp: flags loopback / private / link-local / metadata', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1',
                     '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.strictEqual(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test('isPrivateIp: allows public addresses', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.strictEqual(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test('isPrivateIp: unwraps IPv4-mapped IPv6', () => {
  assert.strictEqual(isPrivateIp('::ffff:169.254.169.254'), true);
});

test('validateDownloadUrl: magnet links are allowed (not a host fetch)', async () => {
  const r = await validateDownloadUrl('magnet:?xt=urn:btih:abc');
  assert.strictEqual(r.ok, true);
});

test('validateDownloadUrl: blocks cloud metadata IP', async () => {
  const r = await validateDownloadUrl('http://169.254.169.254/latest/meta-data/');
  assert.strictEqual(r.ok, false);
});

test('validateDownloadUrl: blocks localhost', async () => {
  const r = await validateDownloadUrl('http://localhost:6800/jsonrpc');
  assert.strictEqual(r.ok, false);
});

test('validateDownloadUrl: blocks private IP literal', async () => {
  const r = await validateDownloadUrl('https://192.168.0.1/file.iso');
  assert.strictEqual(r.ok, false);
});

test('validateDownloadUrl: rejects malformed URL', async () => {
  const r = await validateDownloadUrl('not a url');
  assert.strictEqual(r.ok, false);
});
