'use strict';

// A valid secret must be set before requiring the auth module.
process.env.JWT_SECRET = 'test-secret-0123456789-abcdef';

const test = require('node:test');
const assert = require('node:assert');
const {
  generateToken,
  verifyToken,
  generateStreamToken,
  extractToken,
  hashPassword,
  comparePassword,
  assertSecretConfigured,
  DEFAULT_SECRET,
} = require('../lib/auth');

test('generateToken / verifyToken round-trips the payload', () => {
  const token = generateToken({ username: 'alice' });
  const decoded = verifyToken(token);
  assert.strictEqual(decoded.username, 'alice');
});

test('generateStreamToken is scoped to a single file path', () => {
  const token = generateStreamToken('movies/a.mp4');
  const decoded = verifyToken(token);
  assert.strictEqual(decoded.t, 'stream');
  assert.strictEqual(decoded.p, 'movies/a.mp4');
});

test('verifyToken rejects a tampered token', () => {
  const token = generateToken({ username: 'alice' });
  assert.throws(() => verifyToken(token + 'x'));
});

test('extractToken reads the Authorization header', () => {
  const req = { headers: { authorization: 'Bearer abc.def.ghi' }, query: {} };
  assert.strictEqual(extractToken(req), 'abc.def.ghi');
});

test('extractToken falls back to the query token', () => {
  const req = { headers: {}, query: { token: 'qtok' } };
  assert.strictEqual(extractToken(req), 'qtok');
});

test('extractToken prefers the header over the query', () => {
  const req = { headers: { authorization: 'Bearer hdr' }, query: { token: 'qtok' } };
  assert.strictEqual(extractToken(req), 'hdr');
});

test('extractToken returns null when no token is present', () => {
  assert.strictEqual(extractToken({ headers: {}, query: {} }), null);
});

test('password hashing verifies correctly and rejects wrong passwords', async () => {
  const hash = await hashPassword('s3cret-pass');
  assert.ok(await comparePassword('s3cret-pass', hash));
  assert.strictEqual(await comparePassword('wrong', hash), false);
});

test('assertSecretConfigured throws on the insecure default', () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = DEFAULT_SECRET;
  assert.throws(() => assertSecretConfigured(), /insecure default/);
  process.env.JWT_SECRET = original;
});

test('assertSecretConfigured throws when secret is too short', () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'short';
  assert.throws(() => assertSecretConfigured(), /too short/);
  process.env.JWT_SECRET = original;
});

test('assertSecretConfigured passes with a strong secret', () => {
  assert.doesNotThrow(() => assertSecretConfigured());
});
