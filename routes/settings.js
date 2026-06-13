'use strict';

const express = require('express');
const { authMiddleware } = require('../lib/auth');
const settings = require('../lib/settings');

const router = express.Router();
router.use(authMiddleware);

// Read current settings (auto-upload + notifications).
router.get('/', (req, res) => {
  res.json(settings.getAll());
});

// Update settings (partial patch is merged).
router.post('/', async (req, res) => {
  try {
    const next = await settings.update(req.body || {});
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
