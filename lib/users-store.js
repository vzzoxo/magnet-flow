'use strict';

const fs = require('fs/promises');
const { USERS_FILE } = require('./config');

// Simple promise-chain mutex. Every critical section appends to the chain so
// they run strictly one after another, preventing lost updates on the
// read-modify-write cycle of users.json.
let lock = Promise.resolve();

/**
 * Run `fn` exclusively with respect to other withLock calls.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withLock(fn) {
  const run = lock.then(fn, fn);
  // Keep the chain alive even if fn rejects, but don't swallow the result.
  lock = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Read the users database from disk.
 * @returns {Promise<{users: Array<{username: string, password: string}>}>}
 */
async function readUsers() {
  const raw = await fs.readFile(USERS_FILE, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Write the users database to disk.
 * @param {object} data
 */
async function writeUsers(data) {
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Atomically read, mutate and persist the users database.
 * @template T
 * @param {(data: object) => (T | Promise<T>)} mutator - returns a value to pass back
 * @returns {Promise<T>}
 */
function updateUsers(mutator) {
  return withLock(async () => {
    const data = await readUsers();
    const result = await mutator(data);
    await writeUsers(data);
    return result;
  });
}

// ── Token-version cache (for password-change token revocation) ──────────────
let _tvCache = { at: 0, map: null };

/**
 * Return a map of username -> tokenVersion, cached for 5s to avoid a disk read
 * on every authenticated request.
 * @returns {Promise<Record<string, number>>}
 */
async function getTokenVersions() {
  if (_tvCache.map && Date.now() - _tvCache.at < 5000) return _tvCache.map;
  const map = {};
  try {
    const data = await readUsers();
    for (const u of data.users || []) map[u.username] = u.tokenVersion || 0;
  } catch {
    // On read failure, return an empty map (fail-open on revocation only;
    // signature/expiry checks still apply).
  }
  _tvCache = { at: Date.now(), map };
  return map;
}

/** Drop the cache so the next check re-reads from disk (call after a write). */
function invalidateTokenVersionCache() {
  _tvCache = { at: 0, map: null };
}

// writeUsers/withLock are intentionally internal; only these are part of the
// module's public surface.
module.exports = { readUsers, updateUsers, getTokenVersions, invalidateTokenVersionCache };
