'use strict';

/**
 * Lightweight download-completion notifier (Telegram + Bark). Config is passed
 * in (from the settings store) so it can be changed at runtime via the UI.
 * @typedef {{telegramToken?:string, telegramChat?:string, barkUrl?:string}} NotifyConfig
 */

/** @param {NotifyConfig} cfg */
function notifyEnabled(cfg) {
  if (!cfg) return false;
  return !!(cfg.telegramToken && cfg.telegramChat) || !!cfg.barkUrl;
}

/**
 * Send a notification to all configured channels (best-effort, never throws).
 * @param {string} title
 * @param {string} body
 * @param {NotifyConfig} cfg
 */
async function notify(title, body, cfg) {
  if (!cfg) return;
  const tasks = [];

  if (cfg.telegramToken && cfg.telegramChat) {
    tasks.push(
      fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.telegramChat, text: `${title}\n${body}` }),
      }).catch(() => {})
    );
  }

  const bark = (cfg.barkUrl || '').replace(/\/$/, '');
  if (bark) {
    tasks.push(fetch(`${bark}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`).catch(() => {}));
  }

  await Promise.allSettled(tasks);
}

module.exports = { notify, notifyEnabled };
