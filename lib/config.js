'use strict';

const path = require('path');
const Aria2Client = require('./aria2-client');
const RcloneClient = require('./rclone-client');

// ── Shared configuration ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/root/downloads';
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Maximum number of waiting/stopped downloads returned by default.
const MAX_LIST = 1000;

// Auto-clear completed download records (keeps the files, removes only the
// aria2 record). Disable with AUTO_CLEAR_COMPLETED=false. The grace period
// keeps a finished item visible briefly before it is cleared.
const AUTO_CLEAR_COMPLETED = process.env.AUTO_CLEAR_COMPLETED !== 'false';
const _delay = parseInt(process.env.AUTO_CLEAR_DELAY_SEC, 10);
const AUTO_CLEAR_DELAY_SEC = Number.isNaN(_delay) ? 15 : Math.max(0, _delay);

// ── Shared aria2 client (single instance reused across the app) ─────────────
const aria2 = new Aria2Client(
  process.env.ARIA2_RPC_URL || 'http://localhost:6800/jsonrpc',
  process.env.ARIA2_SECRET || ''
);

// ── Shared rclone rc client (for uploads to cloud remotes) ──────────────────
const RCLONE_RC_URL = process.env.RCLONE_RC_URL || 'http://127.0.0.1:5572';
const rclone = new RcloneClient(RCLONE_RC_URL);

module.exports = {
  PORT,
  DOWNLOAD_DIR,
  DATA_DIR,
  USERS_FILE,
  PUBLIC_DIR,
  MAX_LIST,
  AUTO_CLEAR_COMPLETED,
  AUTO_CLEAR_DELAY_SEC,
  RCLONE_RC_URL,
  aria2,
  rclone,
};
