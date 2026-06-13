'use strict';

const fs = require('fs/promises');
const path = require('path');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'settings.json');

// Defaults seed from env (so existing .env-based config still works) and are
// then overridden by anything saved via the UI into settings.json.
function defaults() {
  return {
    autoUpload: {
      enabled: !!process.env.AUTO_UPLOAD_REMOTE,
      remote: process.env.AUTO_UPLOAD_REMOTE || '',
      dest: process.env.AUTO_UPLOAD_DEST || '',
    },
    notify: {
      telegramToken: process.env.NOTIFY_TELEGRAM_BOT_TOKEN || '',
      telegramChat: process.env.NOTIFY_TELEGRAM_CHAT_ID || '',
      barkUrl: process.env.NOTIFY_BARK_URL || '',
    },
    aria2: {
      // Global upload speed cap, e.g. "1M", "500K", or "" / "0" = unlimited.
      maxUploadLimit: process.env.ARIA2_MAX_UPLOAD_LIMIT || '',
    },
  };
}

let state = defaults();

function merge(base, patch) {
  const out = { autoUpload: { ...base.autoUpload }, notify: { ...base.notify }, aria2: { ...base.aria2 } };
  if (patch && patch.autoUpload) Object.assign(out.autoUpload, patch.autoUpload);
  if (patch && patch.notify) Object.assign(out.notify, patch.notify);
  if (patch && patch.aria2) Object.assign(out.aria2, patch.aria2);
  return out;
}

async function init() {
  try {
    const saved = JSON.parse(await fs.readFile(FILE, 'utf-8'));
    state = merge(defaults(), saved);
  } catch {
    state = defaults();
  }
  return state;
}

async function update(patch) {
  state = merge(state, patch);
  await fs.writeFile(FILE, JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

const getAll = () => state;
const getAutoUpload = () => state.autoUpload;
const getNotify = () => state.notify;
const getAria2 = () => state.aria2;

module.exports = { init, update, getAll, getAutoUpload, getNotify, getAria2, FILE };
