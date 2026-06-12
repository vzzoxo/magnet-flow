'use strict';

/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 * Suitable for a single-process self-hosted app. For multi-process or
 * clustered deployments use a shared store (Redis) instead.
 *
 * @param {object} [opts]
 * @param {number} [opts.windowMs=900000] - Window length in ms (default 15 min)
 * @param {number} [opts.max=10] - Max requests per key per window
 * @param {(req: import('express').Request) => string} [opts.keyGenerator]
 * @param {string} [opts.message]
 * @returns {import('express').RequestHandler}
 */
function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 10,
  keyGenerator = (req) => req.ip,
  message = 'Too many requests, please try again later.',
} = {}) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  // Periodically evict expired entries so the map cannot grow unbounded.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = keyGenerator(req) || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: message });
    }

    next();
  };
}

module.exports = rateLimit;
