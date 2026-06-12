'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getTokenVersions } = require('./users-store');

const DEFAULT_SECRET = 'magnetflow-secret-change-this-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';
// Short-lived, single-file scoped token used only for media streaming URLs.
const STREAM_TOKEN_EXPIRY = '15m';

/**
 * Validate that a strong JWT secret is configured.
 * Call once at startup; throws if the secret is missing or left at the
 * insecure default value.
 * @throws {Error}
 */
function assertSecretConfigured() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_SECRET) {
    throw new Error(
      'JWT_SECRET is missing or set to the insecure default. ' +
        'Set a strong, random JWT_SECRET in your environment (.env) before starting. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  if (process.env.JWT_SECRET.length < 16) {
    throw new Error('JWT_SECRET is too short; use at least 16 characters.');
  }
}

/**
 * Hash a plaintext password using bcrypt.
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a signed JWT token.
 * @param {object} payload - Data to embed in the token
 * @returns {string} Signed JWT
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Generate a short-lived token that authorizes streaming a single file only.
 * Embedded in the media URL instead of the long-lived session JWT, so a leaked
 * URL grants nothing more than ~15 minutes of access to that one file.
 * @param {string} relativePath - file path (relative to DOWNLOAD_DIR)
 * @returns {string}
 */
function generateStreamToken(relativePath) {
  return jwt.sign({ t: 'stream', p: relativePath }, JWT_SECRET, {
    expiresIn: STREAM_TOKEN_EXPIRY,
  });
}

/**
 * Short-lived token authorizing streaming of a single object on a cloud
 * remote (rclone). Scoped to one remote + path.
 * @param {string} remote
 * @param {string} relativePath
 * @returns {string}
 */
function generateRemoteStreamToken(remote, relativePath) {
  return jwt.sign({ t: 'rstream', r: remote, p: relativePath }, JWT_SECRET, {
    expiresIn: STREAM_TOKEN_EXPIRY,
  });
}

/**
 * Verify and decode a JWT token.
 * @param {string} token
 * @returns {object} Decoded payload
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Extract a bearer token from the Authorization header, or — as a fallback —
 * from the `token` query parameter. The query fallback exists for media
 * streaming where the browser's <video> element cannot send custom headers.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (typeof req.query?.token === 'string' && req.query.token) {
    return req.query.token;
  }
  return null;
}

/**
 * Build an Express auth middleware.
 * @param {object} [opts]
 * @param {boolean} [opts.allowQueryToken=false] - Accept token via ?token= query
 * @returns {import('express').RequestHandler}
 */
function makeAuthMiddleware({ allowQueryToken = false } = {}) {
  return async function authMiddleware(req, res, next) {
    try {
      const token = allowQueryToken
        ? extractToken(req)
        : (req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7)
            : null);

      if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const decoded = verifyToken(token);

      // Revoke old session tokens after a password change. Stream-scoped
      // tokens carry no username and are exempt (they are short-lived).
      if (decoded.t !== 'stream' && decoded.username) {
        const versions = await getTokenVersions();
        const current = versions[decoded.username];
        if (current !== undefined && (decoded.tv || 0) !== current) {
          return res.status(401).json({ error: 'Session expired, please log in again' });
        }
      }

      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// Header-only middleware (used by JSON APIs).
const authMiddleware = makeAuthMiddleware();

// Header-or-query middleware (used by media streaming endpoints).
const streamAuthMiddleware = makeAuthMiddleware({ allowQueryToken: true });

module.exports = {
  DEFAULT_SECRET,
  assertSecretConfigured,
  hashPassword,
  comparePassword,
  generateToken,
  generateStreamToken,
  generateRemoteStreamToken,
  verifyToken,
  extractToken,
  authMiddleware,
  streamAuthMiddleware,
};
