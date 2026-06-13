'use strict';

const fs = require('fs/promises');
const path = require('path');
const { DATA_DIR, DOWNLOAD_DIR, aria2 } = require('./config');

const FILE = path.join(DATA_DIR, 'rss.json');

async function read() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf-8'));
  } catch {
    return { subs: [] };
  }
}

async function write(data) {
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function stripTag(s, t) {
  const m = s.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)<\\/' + t + '>', 'i'));
  return m ? m[1] : '';
}
function clean(s) {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Parse an RSS/Atom feed into [{title, url, guid}]. */
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = clean(stripTag(b, 'title'));
    const link = stripTag(b, 'link').trim();
    const enc = b.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
    const atom = b.match(/<link[^>]*href=["']([^"']+)["']/i);
    const guid = clean(stripTag(b, 'guid'));

    let url = '';
    if (enc) url = enc[1];
    else if (/^(magnet:|https?:)/i.test(link)) url = link;
    else if (atom) url = atom[1];

    if (url) items.push({ title, url: url.trim().replace(/&amp;/g, '&'), guid: (guid || url).trim() });
  }
  return items;
}

function matches(title, filter) {
  if (!filter) return true;
  try {
    return new RegExp(filter, 'i').test(title);
  } catch {
    return title.toLowerCase().includes(filter.toLowerCase());
  }
}

/**
 * Check one subscription. With baseline=true, mark current items as seen
 * WITHOUT downloading (so only future items trigger).
 * @returns {Promise<number>} number of new downloads added
 */
async function checkSub(sub, baseline = false) {
  const res = await fetch(sub.url, { headers: { 'User-Agent': 'MagnetFlow-RSS' }, redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  const items = parseFeed(xml);

  const seen = new Set(sub.seen || []);
  let added = 0;
  for (const it of items) {
    if (seen.has(it.guid)) continue;
    seen.add(it.guid);
    if (!baseline && matches(it.title, sub.filter)) {
      try {
        await aria2.addUri([it.url], { dir: DOWNLOAD_DIR });
        added += 1;
      } catch {
        /* skip this item */
      }
    }
  }
  sub.seen = [...seen].slice(-800);
  sub.lastCheck = new Date().toISOString();
  sub.lastError = '';
  sub.itemCount = items.length;
  return added;
}

/** Check all enabled subscriptions; persists updated state. */
async function checkAll() {
  const data = await read();
  if (!data.subs || !data.subs.length) return 0;
  let total = 0;
  for (const sub of data.subs) {
    if (sub.enabled === false) continue;
    try {
      const n = await checkSub(sub);
      total += n;
      if (n) console.log(`[MagnetFlow][RSS] "${sub.name}" added ${n} item(s)`);
    } catch (e) {
      sub.lastError = e.message;
    }
  }
  await write(data);
  return total;
}

module.exports = { read, write, parseFeed, matches, checkSub, checkAll, FILE };
