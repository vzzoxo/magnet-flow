'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolveSafePath, isAccessDenied } = require('../lib/paths');

const BASE = '/srv/downloads';

test('resolveSafePath: relative path inside base is allowed', () => {
  assert.strictEqual(resolveSafePath('movies/a.mp4', BASE), path.join(BASE, 'movies/a.mp4'));
});

test('resolveSafePath: empty path resolves to base itself', () => {
  assert.strictEqual(resolveSafePath('', BASE), path.resolve(BASE));
});

test('resolveSafePath: dot-dot traversal is rejected', () => {
  assert.throws(() => resolveSafePath('../../etc/passwd', BASE), /Access denied/);
});

test('resolveSafePath: absolute path outside base is rejected', () => {
  assert.throws(() => resolveSafePath('/etc/passwd', BASE), /Access denied/);
});

test('resolveSafePath: absolute path inside base is allowed', () => {
  assert.strictEqual(resolveSafePath('/srv/downloads/x', BASE), '/srv/downloads/x');
});

test('resolveSafePath: sibling prefix directory is rejected', () => {
  // "/srv/downloads-secret" must not be treated as inside "/srv/downloads"
  assert.throws(() => resolveSafePath('../downloads-secret/f', BASE), /Access denied/);
});

test('resolveSafePath: nested traversal escaping back out is rejected', () => {
  assert.throws(() => resolveSafePath('a/b/../../../outside', BASE), /Access denied/);
});

test('isAccessDenied: recognises traversal errors only', () => {
  assert.strictEqual(isAccessDenied(new Error('Access denied: path is outside')), true);
  assert.strictEqual(isAccessDenied(new Error('ENOENT')), false);
  assert.strictEqual(isAccessDenied(null), false);
});
