'use strict';

const path = require('path');

/**
 * Resolve and validate a path, ensuring it stays within the allowed base
 * directory. Prevents path traversal attacks (e.g. "../../etc/passwd").
 *
 * @param {string} requestedPath - The path from the request (relative or absolute)
 * @param {string} baseDir - The allowed base directory
 * @returns {string} The resolved, safe absolute path
 * @throws {Error} If the path escapes the base directory
 */
function resolveSafePath(requestedPath, baseDir) {
  const normalizedBase = path.resolve(baseDir);
  // path.resolve ignores baseDir entirely when requestedPath is absolute,
  // so an absolute path outside the base will simply fail the check below.
  const resolved = path.resolve(normalizedBase, requestedPath || '');

  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error('Access denied: path is outside the allowed directory');
  }

  return resolved;
}

/**
 * @param {Error} err
 * @returns {boolean} true if the error is a path-traversal denial
 */
function isAccessDenied(err) {
  return typeof err?.message === 'string' && err.message.includes('Access denied');
}

module.exports = { resolveSafePath, isAccessDenied };
