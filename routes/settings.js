'use strict';

const express = require('express');
const { authMiddleware } = require('../lib/auth');
const settings = require('../lib/settings');
const { aria2 } = require('../lib/config');

const router = express.Router();
router.use(authMiddleware);

/** Apply the configured upload speed cap to the running aria2 (best-effort). */
async function applyUploadLimit(s) {
  const limit = (s.aria2 && s.aria2.maxUploadLimit) || '0';
  try { await aria2.changeGlobalOption({ 'max-overall-upload-limit': String(limit || '0') }); } catch { /* aria2 may be down */ }
}

// Read current settings (auto-upload + notifications + aria2).
router.get('/', (req, res) => {
  res.json(settings.getAll());
});

// Update settings (partial patch is merged).
router.post('/', async (req, res) => {
  try {
    const next = await settings.update(req.body || {});
    if (req.body && req.body.aria2) await applyUploadLimit(next);
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
