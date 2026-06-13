'use strict';

/**
 * Lightweight download-completion notifier. Supports Telegram bots and Bark
 * (iOS push). Configure via env; all channels are best-effort.
 *
 *   NOTIFY_TELEGRAM_BOT_TOKEN, NOTIFY_TELEGRAM_CHAT_ID
 *   NOTIFY_BARK_URL   (e.g. https://api.day.app/yourkey)
 */
const TG_TOKEN = process.env.NOTIFY_TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.NOTIFY_TELEGRAM_CHAT_ID || '';
const BARK = (process.env.NOTIFY_BARK_URL || '').replace(/\/$/, '');

function notifyEnabled() {
  return !!(TG_TOKEN && TG_CHAT) || !!BARK;
}

/**
 * Send a notification to all configured channels (best-effort, never throws).
 * @param {string} title
 * @param {string} body
 */
async function notify(title, body) {
  const tasks = [];

  if (TG_TOKEN && TG_CHAT) {
    tasks.push(
      fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text: `${title}\n${body}` }),
      }).catch(() => {})
    );
  }

  if (BARK) {
    const url = `${BARK}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
    tasks.push(fetch(url).catch(() => {}));
  }

  await Promise.allSettled(tasks);
}

module.exports = { notify, notifyEnabled };
