'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyAdmin, isClientAccessValid, signupClient, loginClient } = require('../db');
const { sendAccessCode, emailEnabled } = require('../email');
const { sign, setCookie, clearCookie, authFromReq } = require('../auth');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.post('/login', loginLimiter, (req, res) => {
  const body = req.body || {};
  const ident = String(body.email || body.username || '').trim();
  const password = String(body.password || '');
  const accessCode = String(body.accessCode || '').trim();

  function clientSession(client) {
    const requireSub = process.env.REQUIRE_SUBSCRIPTION !== 'false';
    if (requireSub && client.status !== 'active') {
      return res.status(403).json({
        error: 'Subscription required. Purchase a package to unlock your portal.',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }
    if (!isClientAccessValid(client)) {
      return res.status(403).json({
        error: 'Your access has expired. Renew your dashboard access to continue.',
        code: 'ACCESS_EXPIRED'
      });
    }
    setCookie(res, sign({ role: 'client', clientId: client.id, accessCode: client.access_code }), 'client');
    return res.json({ role: 'client', clientId: client.id, name: client.name, accessCode: client.access_code });
  }

  if (!ident || !password) return res.status(400).json({ error: 'Enter your email and password.' });

  if (verifyAdmin(ident, password)) {
    setCookie(res, sign({ role: 'admin' }), 'admin');
    return res.json({ role: 'admin' });
  }

  if (!accessCode) return res.status(400).json({ error: 'Enter the access code from your email.' });
  const result = loginClient({ email: ident, password, accessCode });
  if (!result.client) {
    const status = /8 characters/.test(result.error || '') ? 400 : 401;
    return res.status(status).json({ error: result.error || 'Incorrect email or password.' });
  }
  return clientSession(result.client);
});

router.post('/signup', loginLimiter, async (req, res) => {
  try {
    const client = signupClient(req.body || {});
    let emailed = false;
    if (emailEnabled()) {
      try {
        await sendAccessCode(client, { force: true });
        emailed = true;
      } catch (err) {
        console.error('[email] signup access code:', err.message);
      }
    }
    const out = { ok: true, emailed };
    if (!emailed) out.accessCode = client.access_code;
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not create account.' });
  }
});

router.post('/logout', (req, res) => { clearCookie(res); res.json({ ok: true }); });

router.get('/me', (req, res) => {
  const u = authFromReq(req);
  if (!u) return res.status(401).json({ error: 'Not authenticated' });
  res.json(u);
});

module.exports = router;
