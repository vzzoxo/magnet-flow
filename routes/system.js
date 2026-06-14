'use strict';

const express = require('express');
const os = require('os');
const { statfs } = require('fs/promises');
const { authMiddleware } = require('../lib/auth');
const { aria2, DOWNLOAD_DIR } = require('../lib/config');
const pkg = require('../package.json');

const router = express.Router();

// All system routes require authentication.
router.use(authMiddleware);

/** Disk usage of the filesystem holding DOWNLOAD_DIR. */
async function diskUsage() {
  try {
    const s = await statfs(DOWNLOAD_DIR);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize; // space available to the app
    return { total, free, used: total - free, path: DOWNLOAD_DIR };
  } catch {
    return null;
  }
}

/**
 * GET /disk — lightweight disk usage (for the sidebar widget).
 */
router.get('/disk', async (req, res) => {
  const disk = await diskUsage();
  if (!disk) return res.status(500).json({ error: '无法读取磁盘信息' });
  res.json(disk);
});

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
    disk: await diskUsage(),
  });
});

module.exports = router;
