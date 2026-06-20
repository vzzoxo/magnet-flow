'use strict';

require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const compression = require('compression');

const { verifyToken, hashPassword, assertSecretConfigured } = require('./lib/auth');
const {
  PORT,
  HOST,
  DOWNLOAD_DIR,
  DATA_DIR,
  USERS_FILE,
  PUBLIC_DIR,
  AUTO_CLEAR_COMPLETED,
  AUTO_CLEAR_DELAY_SEC,
  AUTO_UPLOAD_REMOTE,
  AUTO_UPLOAD_DEST,
  aria2,
} = require('./lib/config');
const { notify, notifyEnabled } = require('./lib/notify');
const { startUpload } = require('./lib/uploader');
const settings = require('./lib/settings');
const rss = require('./lib/rss');
const engines = require('./lib/engines');

// Fail fast if the JWT secret is missing or left at the insecure default.
assertSecretConfigured();

// ── Express App ─────────────────────────────────────────────────────────
const app = express();

// Trust the first proxy hop so req.ip reflects the real client (used by the
// login rate limiter). Adjust if you run behind multiple proxies.
app.set('trust proxy', 1);

// Basic security response headers (lightweight alternative to helmet).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// Cap request body size to mitigate memory-exhaustion DoS.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Enable gzip/deflate compression for all responses.
app.use(compression({ threshold: 1024 }));

// Serve static files with cache headers. The ?v= query string in HTML
// references ensures stale caches are busted on upgrades.
app.use(express.static(PUBLIC_DIR, {
  maxAge: '7d',
  immutable: true,
  etag: true,
  lastModified: true,
}));

// Mount API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/downloads', require('./routes/downloads'));
app.use('/api/files', require('./routes/files'));
app.use('/api/stream', require('./routes/stream'));
app.use('/api/system', require('./routes/system'));
app.use('/api/remotes', require('./routes/remotes'));
app.use('/api/rss', require('./routes/rss'));
app.use('/api/settings', require('./routes/settings'));

// Unknown API routes return JSON 404 (not the SPA HTML fallback below).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Cache the index.html lookup once at startup.
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const _indexExists = fs.existsSync(INDEX_HTML);

// SPA fallback: serve index.html for any non-API GET request
app.get('*', (req, res) => {
  if (_indexExists) {
    res.sendFile(INDEX_HTML);
  } else {
    res.status(404).json({ error: 'Frontend not found. Place index.html in public/' });
  }
});

// ── HTTP Server ─────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket Server ────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// Track authenticated connections
const authenticatedClients = new Set();

wss.on('connection', (ws) => {
  let isAuthenticated = false;
  let username = 'unknown';

  console.log('[MagnetFlow] WebSocket client connected');

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return; // Ignore malformed messages
    }

    if (message.type === 'auth' && message.token) {
      try {
        const decoded = verifyToken(message.token);
        isAuthenticated = true;
        username = decoded.username || 'unknown';
        authenticatedClients.add(ws);

        ws.send(JSON.stringify({
          type: 'auth',
          success: true,
          message: 'Authenticated successfully',
        }));

        console.log(`[MagnetFlow] WebSocket authenticated: ${username}`);
      } catch {
        ws.send(JSON.stringify({
          type: 'auth',
          success: false,
          message: 'Invalid or expired token',
        }));
      }
      return;
    }

    // Any non-auth message before authentication is rejected.
    if (!isAuthenticated) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Authentication required',
      }));
    }
    // (No other client message types are currently handled.)
  });

  ws.on('close', () => {
    isAuthenticated = false;
    authenticatedClients.delete(ws);
    console.log(`[MagnetFlow] WebSocket disconnected: ${username}`);
  });

  ws.on('error', (err) => {
    console.error(`[MagnetFlow] WebSocket error (${username}):`, err.message);
    authenticatedClients.delete(ws);
  });
});

/**
 * Broadcast a message to all authenticated WebSocket clients.
 * Skips broadcasting if the data hasn't changed since the last push.
 * @param {object} data - Data to broadcast (will be JSON.stringify'd)
 */
let _lastBroadcastHash = '';
function broadcast(data) {
  const payload = JSON.stringify(data);
  // Skip if the data is identical to the last broadcast (fast length+prefix check)
  const hash = payload.length + ':' + payload.slice(0, 200);
  if (hash === _lastBroadcastHash) return;
  _lastBroadcastHash = hash;

  for (const client of authenticatedClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(payload);
      } catch {
        authenticatedClients.delete(client);
      }
    } else {
      authenticatedClients.delete(client);
    }
  }
}

// Poll aria2 every 2 seconds and broadcast download status
let pollingInterval = null;

// Tracks when each completed download was first observed, so we can keep it
// visible for a short grace period before auto-clearing its record.
const completedFirstSeen = new Map();

// Fire-once handling (notify / auto-upload) for newly completed downloads.
const completionHandled = new Set();

function downloadName(dl) {
  if (dl.bittorrent && dl.bittorrent.info && dl.bittorrent.info.name) return dl.bittorrent.info.name;
  if (dl.files && dl.files[0] && dl.files[0].path) return path.basename(dl.files[0].path);
  return dl.gid;
}

function completedPath(dl) {
  const name = dl.bittorrent && dl.bittorrent.info && dl.bittorrent.info.name;
  if (name && dl.dir) return path.join(dl.dir, name);
  if (dl.files && dl.files[0] && dl.files[0].path) return dl.files[0].path;
  return null;
}

/**
 * Notify and/or auto-upload when a download newly completes. Skips BitTorrent
 * metadata entries (they spawn the real download via followedBy).
 * @param {object[]} stopped
 */
async function handleCompletions(stopped) {
  const au = settings.getAutoUpload();
  const ncfg = settings.getNotify();
  const autoUploadOn = !!(au && au.enabled && au.remote);
  const notifyOn = notifyEnabled(ncfg);
  if (!notifyOn && !autoUploadOn) return;
  const present = new Set();
  for (const dl of stopped) {
    if (dl.status !== 'complete') continue;
    if (Array.isArray(dl.followedBy) && dl.followedBy.length) continue; // metadata
    present.add(dl.gid);
    if (completionHandled.has(dl.gid)) continue;
    completionHandled.add(dl.gid);

    const name = downloadName(dl);
    if (notifyOn) {
      notify('✅ 下载完成', name, ncfg).catch(() => {});
    }
    if (autoUploadOn) {
      const abs = completedPath(dl);
      if (abs) {
        startUpload(abs, au.remote, au.dest)
          .then((j) => console.log(`[MagnetFlow] Auto-upload "${name}" → ${au.remote} (job ${j.jobid})`))
          .catch((e) => console.error(`[MagnetFlow] Auto-upload failed for "${name}":`, e.message));
      }
    }
  }
  for (const gid of completionHandled) {
    if (!present.has(gid)) completionHandled.delete(gid);
  }
}

/**
 * Auto-clear completed download *records* (files on disk are kept).
 * Uses aria2.removeDownloadResult, which never deletes downloaded files.
 * Error/removed records are left untouched so failures stay visible.
 * @param {object[]} stopped - aria2 tellStopped result
 */
async function autoClearCompleted(stopped) {
  if (!AUTO_CLEAR_COMPLETED) return;
  const now = Date.now();
  const delayMs = AUTO_CLEAR_DELAY_SEC * 1000;
  const present = new Set();

  for (const dl of stopped) {
    if (dl.status !== 'complete') continue;
    present.add(dl.gid);

    let firstSeen = completedFirstSeen.get(dl.gid);
    if (firstSeen === undefined) {
      firstSeen = now;
      completedFirstSeen.set(dl.gid, now);
    }

    if (now - firstSeen >= delayMs) {
      try {
        await engines.removeCompletedRecord(dl.gid);
        completedFirstSeen.delete(dl.gid);
        console.log(`[MagnetFlow] Auto-cleared completed record (files kept): gid=${dl.gid}`);
      } catch {
        // Already gone or aria2 hiccup — drop tracking and move on.
        completedFirstSeen.delete(dl.gid);
      }
    }
  }

  // Forget gids that are no longer in the stopped list.
  for (const gid of completedFirstSeen.keys()) {
    if (!present.has(gid)) completedFirstSeen.delete(gid);
  }
}

function startPolling() {
  const poll = async () => {
    const needBroadcast = authenticatedClients.size > 0;
    // Keep polling for auto-clear / completion hooks even when nobody watches.
    const au = settings.getAutoUpload();
    const hooksActive = !!(au && au.enabled && au.remote) || notifyEnabled(settings.getNotify());
    if (!needBroadcast && !AUTO_CLEAR_COMPLETED && !hooksActive) return;

    try {
      const data = await engines.collectDownloads();
      await handleCompletions(data.stopped);
      await autoClearCompleted(data.stopped);

      if (needBroadcast) {
        broadcast({ type: 'downloads', data });
      }
    } catch {
      // engine might not be running — silently ignore
    }
  };

  // Poll immediately on startup to populate cache
  poll();

  pollingInterval = setInterval(poll, 2000);

  const clearMsg = AUTO_CLEAR_COMPLETED
    ? `auto-clear completed records after ${AUTO_CLEAR_DELAY_SEC}s (files kept)`
    : 'auto-clear disabled';
  console.log(`[MagnetFlow] Download status polling started (2s interval, ${clearMsg})`);
}

// ── Startup Initialization ──────────────────────────────────────────────

async function initialize() {
  // Create download directory if it doesn't exist
  try {
    await fsPromises.mkdir(DOWNLOAD_DIR, { recursive: true });
    console.log(`[MagnetFlow] Download directory ready: ${DOWNLOAD_DIR}`);
  } catch (err) {
    console.error(`[MagnetFlow] Failed to create download directory: ${err.message}`);
  }

  // Create data directory if it doesn't exist
  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // directory may already exist
  }

  // Create public directory if it doesn't exist
  try {
    await fsPromises.mkdir(PUBLIC_DIR, { recursive: true });
  } catch {
    // directory may already exist
  }

  // Create default users.json if it doesn't exist
  try {
    await fsPromises.access(USERS_FILE);
    console.log('[MagnetFlow] Users database found');
  } catch {
    // File doesn't exist — create with default admin user.
    // Use INITIAL_ADMIN_PASSWORD if provided, otherwise generate a strong
    // random one and print it ONCE so there is no shared weak default.
    console.log('[MagnetFlow] Creating default users database...');
    const initialPassword =
      process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const defaultPasswordHash = await hashPassword(initialPassword);
    const defaultUsers = {
      users: [
        {
          username: 'admin',
          password: defaultPasswordHash,
        },
      ],
    };

    await fsPromises.writeFile(
      USERS_FILE,
      JSON.stringify(defaultUsers, null, 2),
      'utf-8'
    );

    console.log('');
    console.log('  ┌──────────────────────────────────────────────────────┐');
    console.log('  │  INITIAL ADMIN CREDENTIALS (shown only once)           │');
    console.log('  │  username: admin                                       │');
    console.log(`  │  password: ${initialPassword.padEnd(44)}│`);
    console.log('  │  Log in and change this password immediately.          │');
    console.log('  └──────────────────────────────────────────────────────┘');
    console.log('');
  }

  // Start the server
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║          MagnetFlow Server               ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log(`  ║  🌐 HTTP:  http://localhost:${PORT}          ║`);
    console.log(`  ║  📁 Downloads: ${DOWNLOAD_DIR.padEnd(23)} ║`);
    console.log('  ║  🔌 WebSocket: enabled                   ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
  });

  // Start polling aria2
  await settings.init();
  startPolling();

  // RSS subscriptions: check every 15 minutes (and once shortly after boot).
  const RSS_INTERVAL_MS = 15 * 60 * 1000;
  const rssTick = () => rss.checkAll().catch((e) => console.error('[MagnetFlow][RSS]', e.message));
  setTimeout(rssTick, 30 * 1000);
  const rssInterval = setInterval(rssTick, RSS_INTERVAL_MS);
  if (typeof rssInterval.unref === 'function') { /* keep running */ }

  // Check aria2 connectivity
  try {
    const version = await aria2.getVersion();
    console.log(`[MagnetFlow] Connected to aria2 v${version.version}`);
    // Re-apply the configured upload speed cap (settings survive restarts).
    const up = (settings.getAria2() && settings.getAria2().maxUploadLimit) || '0';
    try { await aria2.changeGlobalOption({ 'max-overall-upload-limit': String(up || '0') }); } catch { /* ignore */ }
  } catch {
    console.warn('[MagnetFlow] ⚠ aria2 is not reachable. Downloads will fail until aria2 is started.');
  }
}

// ── Graceful Shutdown ───────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[MagnetFlow] Received ${signal}. Shutting down gracefully...`);

  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  // Close all WebSocket connections
  for (const client of authenticatedClients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch {
      // ignore
    }
  }

  wss.close(() => {
    server.close(() => {
      console.log('[MagnetFlow] Server stopped.');
      process.exit(0);
    });
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.error('[MagnetFlow] Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the application
initialize().catch((err) => {
  console.error('[MagnetFlow] Fatal initialization error:', err);
  process.exit(1);
});
