'use strict';

const express = require('express');
const { authMiddleware } = require('../lib/auth');
const { aria2, MAX_LIST } = require('../lib/config');
const { validateDownloadUrl } = require('../lib/ssrf-guard');
const engines = require('../lib/engines');

const router = express.Router();
router.use(authMiddleware);

/** GET /engines — available download engines. */
router.get('/engines', async (req, res) => {
  try {
    res.json({ engines: await engines.engineList() });
  } catch {
    res.json({ engines: ['aria2'] });
  }
});

/**
 * POST /add — magnet / HTTP(S) / InfoHash. Body: { url, engine }
 * HTTP(S) is always handled by aria2 (Transmission is BT-only).
 */
router.post('/add', async (req, res) => {
  try {
    const { url, engine } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let finalUrl = url.trim();
    if (/^[a-fA-F0-9]{40}$/.test(finalUrl) || /^[A-Z2-7]{32}$/i.test(finalUrl)) {
      finalUrl = `magnet:?xt=urn:btih:${finalUrl}`;
    }

    const isHttp = finalUrl.startsWith('http://') || finalUrl.startsWith('https://');
    const isMagnet = finalUrl.startsWith('magnet:');
    if (!isHttp && !isMagnet) {
      return res.status(400).json({
        error: 'Invalid URL. Supported: magnet:, http://, https://, or a plain BT InfoHash',
      });
    }

    if (isHttp) {
      const safety = await validateDownloadUrl(finalUrl);
      if (!safety.ok) {
        console.warn(`[MagnetFlow] Blocked download URL (SSRF): ${finalUrl.substring(0, 80)} — ${safety.error}`);
        return res.status(400).json({ error: safety.error });
      }
    }

    // HTTP must use aria2; magnet honours the chosen engine (default aria2).
    const useEngine = isHttp ? 'aria2' : (engine || 'aria2');
    const gid = await engines.addUrl(finalUrl, useEngine);
    console.log(`[MagnetFlow] Download added (${useEngine}): gid=${gid}`);
    res.json({ gid });
  } catch (err) {
    console.error('[MagnetFlow] Add download error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /add-torrent — Body: { torrent (base64), engine } */
router.post('/add-torrent', express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { torrent, engine } = req.body;
    if (!torrent || typeof torrent !== 'string') {
      return res.status(400).json({ error: '缺少种子文件内容' });
    }
    const gid = await engines.addTorrentFile(torrent, engine || 'aria2');
    console.log(`[MagnetFlow] Torrent added (${engine || 'aria2'}): gid=${gid}`);
    res.json({ gid });
  } catch (err) {
    console.error('[MagnetFlow] Add torrent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /list — merged list of both engines. */
router.get('/list', async (req, res) => {
  try {
    res.json(await engines.collectDownloads());
  } catch (err) {
    console.error('[MagnetFlow] List downloads error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/pause/:gid', async (req, res) => {
  try { await engines.pause(req.params.gid); res.json({ gid: req.params.gid }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/resume/:gid', async (req, res) => {
  try { await engines.resume(req.params.gid); res.json({ gid: req.params.gid }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:gid', async (req, res) => {
  try { await engines.remove(req.params.gid); res.json({ gid: req.params.gid, message: 'Download removed' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/** POST /purge — clear aria2 finished records (Transmission auto-clears). */
router.post('/purge', async (req, res) => {
  try {
    await aria2.purgeDownloadResult();
    res.json({ message: 'Download results purged' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /files/:gid — files inside a torrent (for selection). */
router.get('/files/:gid', async (req, res) => {
  try { res.json(await engines.getFiles(req.params.gid)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/** POST /select/:gid — Body: { indexes:[...] } */
router.post('/select/:gid', async (req, res) => {
  try {
    const { indexes } = req.body;
    if (!Array.isArray(indexes) || indexes.length === 0) {
      return res.status(400).json({ error: '请至少选择一个文件' });
    }
    await engines.selectFiles(req.params.gid, indexes);
    res.json({ gid: req.params.gid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
