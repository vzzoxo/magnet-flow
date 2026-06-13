'use strict';

const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../lib/auth');
const rss = require('../lib/rss');

const router = express.Router();
router.use(authMiddleware);

// Return subscriptions without the bulky `seen` arrays.
function publicSubs(subs) {
  return (subs || []).map((s) => ({
    id: s.id, name: s.name, url: s.url, filter: s.filter || '',
    enabled: s.enabled !== false, lastCheck: s.lastCheck || null,
    lastError: s.lastError || '', itemCount: s.itemCount || 0,
    seenCount: (s.seen || []).length,
  }));
}

router.get('/list', async (req, res) => {
  const data = await rss.read();
  res.json({ subs: publicSubs(data.subs) });
});

router.post('/add', async (req, res) => {
  try {
    const { name, url, filter } = req.body;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: '请填写有效的 RSS 链接 (http/https)' });
    }
    const data = await rss.read();
    data.subs = data.subs || [];
    const sub = {
      id: crypto.randomBytes(6).toString('hex'),
      name: (name && name.trim()) || url,
      url: url.trim(),
      filter: (filter || '').trim(),
      enabled: true,
      seen: [],
    };
    // Baseline: record current items as seen so only NEW items trigger.
    try { await rss.checkSub(sub, true); } catch (e) { sub.lastError = e.message; }
    data.subs.push(sub);
    await rss.write(data);
    res.json({ id: sub.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const data = await rss.read();
  data.subs = (data.subs || []).filter((s) => s.id !== req.params.id);
  await rss.write(data);
  res.json({ ok: true });
});

router.post('/toggle/:id', async (req, res) => {
  const data = await rss.read();
  const sub = (data.subs || []).find((s) => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  sub.enabled = sub.enabled === false;
  await rss.write(data);
  res.json({ id: sub.id, enabled: sub.enabled });
});

router.post('/check/:id', async (req, res) => {
  const data = await rss.read();
  const sub = (data.subs || []).find((s) => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  try {
    const added = await rss.checkSub(sub);
    await rss.write(data);
    res.json({ added });
  } catch (err) {
    sub.lastError = err.message;
    await rss.write(data);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
