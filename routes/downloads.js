'use strict';

const express = require('express');
const { authMiddleware } = require('../lib/auth');
const { aria2, DOWNLOAD_DIR, MAX_LIST } = require('../lib/config');
const { validateDownloadUrl } = require('../lib/ssrf-guard');

const router = express.Router();

// All download routes require authentication
router.use(authMiddleware);

/**
 * POST /add
 * Add a new download (magnet link, HTTP/HTTPS URL).
 */
router.post('/add', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let finalUrl = url.trim();

    // Auto-detect plain InfoHash (40 hex chars or 32 base32 chars)
    const isHexHash = /^[a-fA-F0-9]{40}$/.test(finalUrl);
    const isBase32Hash = /^[A-Z2-7]{32}$/i.test(finalUrl);
    
    if (isHexHash || isBase32Hash) {
      finalUrl = `magnet:?xt=urn:btih:${finalUrl}`;
    }

    // Validate URL format
    const isValidUrl =
      finalUrl.startsWith('magnet:') ||
      finalUrl.startsWith('http://') ||
      finalUrl.startsWith('https://');

    if (!isValidUrl) {
      return res.status(400).json({
        error: 'Invalid URL. Supported: magnet:, http://, https://, or a plain BT InfoHash',
      });
    }

    // SSRF guard: reject http(s) targets that resolve to internal addresses
    // (e.g. cloud metadata 169.254.169.254, localhost, private ranges).
    const safety = await validateDownloadUrl(finalUrl);
    if (!safety.ok) {
      console.warn(`[MagnetFlow] Blocked download URL (SSRF): ${finalUrl.substring(0, 80)} — ${safety.error}`);
      return res.status(400).json({ error: safety.error });
    }

    const gid = await aria2.addUri([finalUrl], { dir: DOWNLOAD_DIR });
    console.log(`[MagnetFlow] Download added: gid=${gid}, url=${finalUrl.substring(0, 80)}...`);
    res.json({ gid });
  } catch (err) {
    console.error('[MagnetFlow] Add download error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /add-torrent
 * Add a download from an uploaded .torrent file (base64 in JSON body).
 */
router.post('/add-torrent', express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { torrent } = req.body;
    if (!torrent || typeof torrent !== 'string') {
      return res.status(400).json({ error: '缺少种子文件内容' });
    }
    const gid = await aria2.addTorrent(torrent, { dir: DOWNLOAD_DIR });
    console.log(`[MagnetFlow] Torrent added: gid=${gid}`);
    res.json({ gid });
  } catch (err) {
    console.error('[MagnetFlow] Add torrent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /list
 * List all downloads (active, waiting, stopped) with global stats.
 */
router.get('/list', async (req, res) => {
  try {
    // Pagination for waiting/stopped lists. Active downloads are always
    // returned in full (aria2.tellActive has no pagination).
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const rawNum = parseInt(req.query.num, 10);
    const num = Number.isNaN(rawNum) ? MAX_LIST : Math.min(Math.max(1, rawNum), MAX_LIST);

    const [active, waiting, stopped, stats] = await Promise.all([
      aria2.tellActive(),
      aria2.tellWaiting(offset, num),
      aria2.tellStopped(offset, num),
      aria2.getGlobalStat(),
    ]);

    res.json({ active, waiting, stopped, stats });
  } catch (err) {
    console.error('[MagnetFlow] List downloads error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /status/:gid
 * Get detailed status of a specific download.
 */
router.get('/status/:gid', async (req, res) => {
  try {
    const status = await aria2.tellStatus(req.params.gid);
    res.json(status);
  } catch (err) {
    console.error('[MagnetFlow] Status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pause/:gid
 * Pause a download.
 */
router.post('/pause/:gid', async (req, res) => {
  try {
    const gid = await aria2.pause(req.params.gid);
    console.log(`[MagnetFlow] Download paused: gid=${gid}`);
    res.json({ gid });
  } catch (err) {
    console.error('[MagnetFlow] Pause error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /resume/:gid
 * Resume a paused download.
 */
router.post('/resume/:gid', async (req, res) => {
  try {
    const gid = await aria2.unpause(req.params.gid);
    console.log(`[MagnetFlow] Download resumed: gid=${gid}`);
    res.json({ gid });
  } catch (err) {
    console.error('[MagnetFlow] Resume error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:gid
 * Remove a download. Tries graceful remove first, then force remove.
 */
router.delete('/:gid', async (req, res) => {
  try {
    const { gid } = req.params;
    try {
      await aria2.remove(gid);
    } catch {
      await aria2.forceRemove(gid);
    }
    console.log(`[MagnetFlow] Download removed: gid=${gid}`);
    res.json({ gid, message: 'Download removed' });
  } catch (err) {
    console.error('[MagnetFlow] Remove error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /purge
 * Purge all completed/errored/removed download results.
 */
router.post('/purge', async (req, res) => {
  try {
    await aria2.purgeDownloadResult();
    console.log('[MagnetFlow] Download results purged');
    res.json({ message: 'Download results purged' });
  } catch (err) {
    console.error('[MagnetFlow] Purge error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /files/:gid
 * List files inside a (torrent) download for file selection.
 */
router.get('/files/:gid', async (req, res) => {
  try {
    const status = await aria2.tellStatus(req.params.gid, ['gid', 'files', 'bittorrent', 'totalLength', 'status']);
    res.json(status);
  } catch (err) {
    console.error('[MagnetFlow] Files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /select/:gid
 * Choose which files of a torrent to download. Body: { indexes: [1,2,...] }
 * (1-based aria2 file indices). Empty selection is rejected.
 */
router.post('/select/:gid', async (req, res) => {
  try {
    const { indexes } = req.body;
    if (!Array.isArray(indexes) || indexes.length === 0) {
      return res.status(400).json({ error: '请至少选择一个文件' });
    }
    const sel = indexes.map((n) => parseInt(n, 10)).filter((n) => n > 0).join(',');
    if (!sel) return res.status(400).json({ error: 'Invalid indexes' });
    await aria2.changeOption(req.params.gid, { 'select-file': sel });
    console.log(`[MagnetFlow] select-file gid=${req.params.gid} -> ${sel}`);
    res.json({ gid: req.params.gid, selected: sel });
  } catch (err) {
    console.error('[MagnetFlow] Select error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
