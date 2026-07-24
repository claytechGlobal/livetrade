'use strict';
const express = require('express');
const { requireClient } = require('../auth');
const { getClientPortal, getClientRow, getSettings, composeClientApp, applyClientCsvUpload, saveClientTrades, saveClientAccounts, saveClientPlays } = require('../db');
const { sendContractSubmission, emailEnabled, contractNotifyTo } = require('../email');

const router = express.Router();
router.use(requireClient);

function assertSubscribed(row, res) {
  const requireSub = process.env.REQUIRE_SUBSCRIPTION !== 'false';
  if (requireSub && row.status !== 'active') {
    res.status(403).json({
      error: 'Subscription required. Purchase a package to unlock your portal.',
      code: 'SUBSCRIPTION_REQUIRED'
    });
    return false;
  }
  return true;
}

router.get('/portal', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  if (!assertSubscribed(row, res)) return;
  const client = getClientPortal(row.id);
  if (!client) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  const s = getSettings();
  res.json({ client, settings: { appName: s.appName, accent: s.accent } });
});

router.get('/app', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  if (!assertSubscribed(row, res)) return;
  const data = composeClientApp(row.id);
  if (!data) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  res.json(data);
});

router.post('/daily-csv', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  if (!assertSubscribed(row, res)) return;
  const csv = String((req.body && req.body.csv) || '');
  try {
    const result = applyClientCsvUpload(row.id, csv);
    const data = composeClientApp(row.id);
    if (!data) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
    res.json({ ok: true, result, app: data });
  } catch (e) {
    res.status(400).json({ error: e.message || 'CSV import failed' });
  }
});

router.put('/trades', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  if (!assertSubscribed(row, res)) return;
  try {
    const app = saveClientTrades(row.id, Array.isArray(req.body) ? req.body : []);
    res.json({ ok: true, app });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save trades' });
  }
});

router.put('/accounts', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  if (!assertSubscribed(row, res)) return;
  try {
    const app = saveClientAccounts(row.id, Array.isArray(req.body) ? req.body : []);
    res.json({ ok: true, app });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save accounts' });
  }
});

router.put('/plays', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  if (!assertSubscribed(row, res)) return;
  try {
    saveClientPlays(Array.isArray(req.body) ? req.body : []);
    const app = composeClientApp(row.id);
    res.json({ ok: true, app });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save plays' });
  }
});

router.post('/contract', async (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found. Log out and sign in again with your access code.' });
  if (!assertSubscribed(row, res)) return;
  const body = req.body || {};
  const entries = body.entries && typeof body.entries === 'object' ? body.entries : {};
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const signedAt = body.signedAt || new Date().toISOString();
  try {
    if (!emailEnabled()) {
      return res.status(503).json({ error: 'Email is not configured (set RESEND_API_KEY).' });
    }
    if (!contractNotifyTo()) {
      return res.status(503).json({ error: 'Owner notify email is not set (CONTRACT_NOTIFY_EMAIL).' });
    }
    const result = await sendContractSubmission({
      clientName: row.name,
      clientEmail: row.email,
      clientId: row.id,
      packageKey: row.package,
      signedAt,
      entries,
      answers
    });
    res.json({ ok: true, emailed: !!result.sent, to: result.to || null });
  } catch (e) {
    console.error('[contract]', e);
    res.status(500).json({ error: e.message || 'Could not email contract copy' });
  }
});

module.exports = router;
