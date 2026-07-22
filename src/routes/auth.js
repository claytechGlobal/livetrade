'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyAdmin, findActiveClientByCode, isClientAccessValid } = require('../db');
const { sign, setCookie, clearCookie, authFromReq } = require('../auth');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.post('/login', loginLimiter, (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const credential = String(body.credential || '').trim();

  // Admin: username + password
  if (username || password) {
    if (username && password && verifyAdmin(username, password)) {
      setCookie(res, sign({ role: 'admin' }), 'admin');
      return res.json({ role: 'admin' });
    }
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  // Client: access code
  if (credential) {
    const client = findActiveClientByCode(credential);
    if (client) {
      const requireSub = process.env.REQUIRE_SUBSCRIPTION !== 'false';
      if (requireSub && client.status !== 'active') {
        return res.status(403).json({
          error: 'Subscription required. Purchase a package to unlock your portal.',
          code: 'SUBSCRIPTION_REQUIRED'
        });
      }
      if (!isClientAccessValid(client)) {
        return res.status(403).json({
          error: 'Your access has expired. Renew the $45/mo subscription to get a new month of access.',
          code: 'ACCESS_EXPIRED'
        });
      }
      setCookie(res, sign({ role: 'client', clientId: client.id, accessCode: client.access_code }), 'client');
      return res.json({ role: 'client', clientId: client.id, name: client.name, accessCode: client.access_code });
    }
    return res.status(401).json({ error: 'Invalid access code.' });
  }

  return res.status(400).json({ error: 'Enter your credentials.' });
});

router.post('/logout', (req, res) => { clearCookie(res); res.json({ ok: true }); });

router.get('/me', (req, res) => {
  const u = authFromReq(req);
  if (!u) return res.status(401).json({ error: 'Not authenticated' });
  res.json(u);
});

module.exports = router;
