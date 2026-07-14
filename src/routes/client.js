'use strict';
const express = require('express');
const { requireClient } = require('../auth');
const { getClientPortal, getClientRow, getSettings, composeClientApp, applyClientCsvUpload } = require('../db');

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

module.exports = router;
