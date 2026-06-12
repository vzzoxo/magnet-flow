'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const {
  authMiddleware,
  verifyToken,
  generateRemoteStreamToken,
} = require('../lib/auth');
const { resolveSafePath, isAccessDenied } = require('../lib/paths');
const { rclone, aria2, DOWNLOAD_DIR, RCLONE_RC_URL } = require('../lib/config');

const router = express.Router();

/**
 * Check aria2 whether the given absolute path is part of any active/waiting
 * download (covers BitTorrent, whose control file lives beside the folder, not
 * beside each media file). Uploading an in-progress file always fails.
 * @param {string} absPath
 * @returns {Promise<boolean>}
 */
async function isPathDownloading(absPath) {
  let downloads = [];
  try {
    const [active, waiting] = await Promise.all([
      aria2.tellActive(['files', 'dir', 'bittorrent']),
      aria2.tellWaiting(0, 1000, ['files', 'dir', 'bittorrent']),
    ]);
    downloads = [...(active || []), ...(waiting || [])];
  } catch {
    return false; // aria2 unreachable → don't block uploads
  }

  const target = path.resolve(absPath);
  const overlaps = (a, b) =>
    a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);

  for (const dl of downloads) {
    const name = dl.bittorrent?.info?.name;
    if (name && dl.dir && overlaps(target, path.resolve(dl.dir, name))) return true;
    for (const f of dl.files || []) {
      if (f.path && overlaps(target, path.resolve(f.path))) return true;
    }
  }
  return false;
}

// All remote routes require authentication (the streaming proxy uses a
// query-token instead and is registered before this middleware).
const STREAM_BASE = RCLONE_RC_URL.replace(/\/$/, '');

/** Build the rclone --rc-serve object URL for remote:path. */
function objectUrl(remote, relPath) {
  const encPath = String(relPath || '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `${STREAM_BASE}/%5B${encodeURIComponent(remote)}:%5D/${encPath}`;
}

/**
 * GET /stream?remote=&path=&token=
 * Proxy a cloud object through rclone's object server, preserving Range.
 * Auth via a scoped query token (so <video>/<audio> can stream it) or a
 * normal Authorization header. Registered BEFORE authMiddleware.
 */
router.get('/stream', async (req, res) => {
  const remote = req.query.remote;
  const relPath = req.query.path || '';
  const token = (typeof req.query.token === 'string' && req.query.token) ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Scoped remote-stream tokens may only access their own remote+path.
  if (claims.t === 'rstream' && !(claims.r === remote && claims.p === relPath)) {
    return res.status(403).json({ error: 'Token is not valid for this object' });
  }
  if (!remote) return res.status(400).json({ error: 'remote is required' });

  try {
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(objectUrl(remote, relPath), { headers });

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[MagnetFlow] Remote stream error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Stream failed: ' + err.message });
  }
});

// Everything below requires a normal session token.
router.use(authMiddleware);

/** Strip the trailing ':' from rclone remote names. */
function remoteNames(list) {
  return (list || []).map((r) => r.replace(/:$/, ''));
}

/**
 * GET /list
 * List configured rclone remotes (cloud drives).
 */
router.get('/list', async (req, res) => {
  try {
    const data = await rclone.listRemotes();
    res.json({ remotes: remoteNames(data.remotes) });
  } catch (err) {
    console.error('[MagnetFlow] List remotes error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * POST /upload
 * Copy a local file/folder (inside DOWNLOAD_DIR) to a cloud remote.
 * Body: { path, remote, dest? }  — local files are kept after upload.
 * Returns: { jobid, name }
 */
router.post('/upload', async (req, res) => {
  try {
    const { path: localPath, remote, dest } = req.body;
    if (!localPath || !remote) {
      return res.status(400).json({ error: 'path and remote are required' });
    }

    // Whitelist the remote against the actually-configured ones (prevents
    // pointing the destination at an arbitrary filesystem/target).
    const configured = remoteNames((await rclone.listRemotes()).remotes);
    if (!configured.includes(remote)) {
      return res.status(400).json({ error: `Unknown remote: ${remote}` });
    }

    const absPath = resolveSafePath(localPath, DOWNLOAD_DIR);
    let stat;
    try {
      stat = await fs.stat(absPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const name = path.basename(absPath);

    // Refuse anything aria2 is still downloading (handles single files AND
    // BitTorrent folders). Uploading a file that is still being written fails.
    if (await isPathDownloading(absPath)) {
      return res.status(409).json({ error: '该文件仍在下载中，请等下载完成后再上传' });
    }
    // Cheap fallback: a "<file>.aria2" control file next to a single file.
    if (!stat.isDirectory()) {
      try {
        await fs.access(absPath + '.aria2');
        return res.status(409).json({ error: '该文件仍在下载中，请等下载完成后再上传' });
      } catch { /* finished */ }
    }

    // Normalize the destination folder on the remote (no leading slash).
    const destDir = String(dest || '').replace(/^\/+/, '').replace(/\/+$/, '');

    let job;
    if (stat.isDirectory()) {
      // Copy the folder itself (dest/<name>/...) into the remote.
      const dstFs = `${remote}:${destDir ? destDir + '/' + name : name}`;
      job = await rclone.copyDirAsync(absPath, dstFs);
    } else {
      const dstFs = `${remote}:${destDir}`;
      job = await rclone.copyFileAsync(path.dirname(absPath), name, dstFs, name);
    }

    console.log(`[MagnetFlow] Upload started: ${absPath} → ${remote}:${destDir} (job ${job.jobid})`);
    res.json({ jobid: job.jobid, name, remote, isDirectory: stat.isDirectory() });
  } catch (err) {
    console.error('[MagnetFlow] Upload error:', err.message);
    if (isAccessDenied(err)) return res.status(403).json({ error: err.message });
    res.status(502).json({ error: err.message });
  }
});

/** Turn a verbose rclone error into a short, user-friendly message. */
function cleanUploadError(msg) {
  msg = String(msg || '');
  if (/source file is being updated|mod time changed/i.test(msg)) {
    return '源文件仍在变化（可能还在下载中），请等下载完成后再上传';
  }
  if (/itemNotFound|resource could not be found/i.test(msg)) {
    return '目标位置暂不可用，请稍后重试';
  }
  if (/quota|insufficient|storage/i.test(msg)) {
    return '网盘空间不足';
  }
  if (/unauthor|401|invalid_grant|token/i.test(msg)) {
    return '网盘授权已失效，请重新连接该网盘';
  }
  // Strip URLs/tokens and truncate anything else.
  const stripped = msg.replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);
  return stripped || '上传失败';
}

/**
 * GET /job/:jobid
 * Progress + completion status of an upload job.
 */
router.get('/job/:jobid', async (req, res) => {
  const jobid = parseInt(req.params.jobid, 10);
  if (Number.isNaN(jobid)) return res.status(400).json({ error: 'Invalid jobid' });

  let status;
  try {
    status = await rclone.jobStatus(jobid);
  } catch (err) {
    // rclone returns an error from job/status when the job FAILED, or
    // "job not found" once the finished job has expired. Report it as a
    // finished state instead of a 5xx so the UI stops waiting.
    const msg = err.message || '';
    if (/job not found/i.test(msg)) {
      return res.json({ jobid, finished: true, gone: true, success: false, error: '', percentage: 0 });
    }
    return res.json({ jobid, finished: true, success: false, error: cleanUploadError(msg), percentage: 0 });
  }

  let stats = {};
  try {
    stats = await rclone.stats(`job/${jobid}`);
  } catch {
    // stats group may be gone once the job is finished — ignore
  }

  const totalBytes = Number(stats.totalBytes || 0);
  const bytes = Number(stats.bytes || 0);
  const percentage = totalBytes > 0 ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : (status.finished && status.success ? 100 : 0);

  res.json({
    jobid,
    finished: !!status.finished,
    success: !!status.success,
    error: status.error ? cleanUploadError(status.error) : '',
    bytes,
    totalBytes,
    speed: Number(stats.speed || 0),
    eta: stats.eta,
    percentage,
  });
});

/**
 * GET /browse?remote=&path=
 * List the contents of a folder on a cloud remote.
 */
router.get('/browse', async (req, res) => {
  try {
    const remote = req.query.remote;
    const relPath = String(req.query.path || '').replace(/^\/+/, '');
    if (!remote) return res.status(400).json({ error: 'remote is required' });

    const configured = remoteNames((await rclone.listRemotes()).remotes);
    if (!configured.includes(remote)) {
      return res.status(400).json({ error: `Unknown remote: ${remote}` });
    }

    const data = await rclone.call('operations/list', { fs: `${remote}:`, remote: relPath });
    const items = (data.list || []).map((it) => ({
      name: it.Name,
      path: relPath ? `${relPath}/${it.Name}` : it.Name,
      isDir: !!it.IsDir,
      size: it.Size,
      mimeType: it.MimeType || '',
      modified: it.ModTime,
    }));
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    res.json({ remote, path: relPath, items });
  } catch (err) {
    console.error('[MagnetFlow] Browse remote error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * GET /stream-token?remote=&path=
 * Mint a short-lived token to stream one cloud object.
 */
router.get('/stream-token', async (req, res) => {
  try {
    const remote = req.query.remote;
    const relPath = String(req.query.path || '');
    if (!remote || !relPath) return res.status(400).json({ error: 'remote and path are required' });

    const configured = remoteNames((await rclone.listRemotes()).remotes);
    if (!configured.includes(remote)) {
      return res.status(400).json({ error: `Unknown remote: ${remote}` });
    }
    res.json({ token: generateRemoteStreamToken(remote, relPath) });
  } catch (err) {
    console.error('[MagnetFlow] Stream-token error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
