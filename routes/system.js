'use strict';

const express = require('express');
const os = require('os');
const { authMiddleware } = require('../lib/auth');
const { aria2 } = require('../lib/config');
const pkg = require('../package.json');

const router = express.Router();

// All system routes require authentication.
router.use(authMiddleware);

/**
 * GET /info
 * Runtime/system information for the Settings page.
 */
router.get('/info', async (req, res) => {
  let aria2Version = null;
  let aria2Ok = false;
  try {
    const v = await aria2.getVersion();
    aria2Version = v.version;
    aria2Ok = true;
  } catch {
    // aria2 not reachable — leave null
  }

  res.json({
    name: pkg.name,
    version: pkg.version,
    platform: `${os.type()} ${os.arch()}`,
    node: process.version,
    aria2: aria2Version,
    aria2Ok,
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
