'use strict';

const express = require('express');
const fs = require('fs');
const fsPromises = require('fs/promises');
const mime = require('mime-types');
const {
  authMiddleware,
  verifyToken,
  generateStreamToken,
} = require('../lib/auth');
const { resolveSafePath, isAccessDenied } = require('../lib/paths');
const { DOWNLOAD_DIR } = require('../lib/config');

const router = express.Router();

/**
 * GET /token?path=<relativePath>
 * Mint a short-lived token authorizing streaming of exactly one file.
 * Requires a normal (header) session token.
 */
router.get('/token', authMiddleware, (req, res) => {
  const relativePath = req.query.path;
  if (!relativePath || typeof relativePath !== 'string') {
    return res.status(400).json({ error: 'File path is required' });
  }
  try {
    // Ensure the path is inside DOWNLOAD_DIR before issuing a token for it.
    resolveSafePath(relativePath, DOWNLOAD_DIR);
  } catch (err) {
    if (isAccessDenied(err)) return res.status(403).json({ error: err.message });
    return res.status(400).json({ error: 'Invalid path' });
  }
  res.json({ token: generateStreamToken(relativePath) });
});

/**
 * Auth for the media endpoint: accept a token via ?token= (query) or the
 * Authorization header. A stream-scoped token is only valid for its own file.
 */
function streamAuth(req, res, next) {
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = (typeof req.query.token === 'string' && req.query.token) || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.streamClaims = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * GET /video/*
 * Stream a file with HTTP Range support. Path is relative to DOWNLOAD_DIR.
 */
router.get('/video/*', streamAuth, async (req, res) => {
  try {
    const relativePath = req.params[0];

    if (!relativePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    // A stream-scoped token may only access the exact file it was issued for.
    // A full session token (e.g. via Authorization header) is unrestricted.
    const claims = req.streamClaims || {};
    if (claims.t === 'stream' && claims.p !== relativePath) {
      return res.status(403).json({ error: 'Token is not valid for this file' });
    }

    const filePath = resolveSafePath(relativePath, DOWNLOAD_DIR);

    let stat;
    try {
      stat = await fsPromises.stat(filePath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log(`[MagnetFlow] Stream 404: ${filePath}`);
        return res.status(404).json({ error: 'File not found' });
      }
      throw e;
    }
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot stream a directory' });
    }

    const fileSize = stat.size;
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Accept-Ranges', 'bytes');
    // Allow the browser to cache the streamed media for this session
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start < 0 || start >= fileSize) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).end();
      }

      const clampedEnd = Math.min(end, fileSize - 1);
      const chunkSize = clampedEnd - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      const stream = fs.createReadStream(filePath, {
        start,
        end: clampedEnd,
        highWaterMark: 256 * 1024, // 256KB chunks for smoother streaming
      });
      stream.on('error', (err) => {
        console.error('[MagnetFlow] Stream read error:', err.message);
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      });

      const stream = fs.createReadStream(filePath, {
        highWaterMark: 256 * 1024, // 256KB chunks for smoother streaming
      });
      stream.on('error', (err) => {
        console.error('[MagnetFlow] Stream read error:', err.message);
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    }
  } catch (err) {
    console.error('[MagnetFlow] Stream error:', err.message);
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
