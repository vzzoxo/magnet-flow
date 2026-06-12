'use strict';

const express = require('express');
const {
  comparePassword,
  hashPassword,
  generateToken,
  authMiddleware,
} = require('../lib/auth');
const { readUsers, updateUsers, invalidateTokenVersionCache } = require('../lib/users-store');
const rateLimit = require('../lib/rate-limit');

const router = express.Router();

// Throttle login attempts to slow down brute-force / credential-stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again in a few minutes.',
});

/**
 * POST /login
 * Authenticate with username & password, receive a JWT.
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const data = await readUsers();
    const user = data.users.find((u) => u.username === username);

    if (!user) {
      console.log(`[MagnetFlow] Login failed: user "${username}" not found`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      console.log(`[MagnetFlow] Login failed: wrong password for "${username}"`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken({ username: user.username, tv: user.tokenVersion || 0 });
    console.log(`[MagnetFlow] User "${username}" logged in successfully`);
    res.json({ token, user: { username: user.username } });
  } catch (err) {
    console.error('[MagnetFlow] Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /check
 * Verify the current token is valid. Requires authentication.
 */
router.get('/check', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /change-password
 * Change the authenticated user's password.
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Verify the current password first (outside the lock is fine for reads,
    // but we re-check inside the atomic update to avoid TOCTOU races).
    const result = await updateUsers(async (data) => {
      const userIndex = data.users.findIndex((u) => u.username === req.user.username);
      if (userIndex === -1) {
        return { status: 404, body: { error: 'User not found' } };
      }

      const valid = await comparePassword(currentPassword, data.users[userIndex].password);
      if (!valid) {
        // 400 (not 401) so the frontend's global "session expired" handler
        // does not log the user out — this is a field validation error.
        return { status: 400, body: { error: 'Current password is incorrect' } };
      }

      data.users[userIndex].password = await hashPassword(newPassword);
      // Invalidate all previously issued tokens for this user.
      data.users[userIndex].tokenVersion = (data.users[userIndex].tokenVersion || 0) + 1;
      return { status: 200, body: { message: 'Password changed successfully' } };
    });

    if (result.status === 200) {
      invalidateTokenVersionCache();
      console.log(`[MagnetFlow] Password changed for user "${req.user.username}"`);
    }
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[MagnetFlow] Change password error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
