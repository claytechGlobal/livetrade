'use strict';
const express = require('express');
const { requireAdmin } = require('../auth');
const {
  composeBootstrap, replacePlays, replaceTrades, replaceAccounts, replaceClients,
  replaceDayPnl, replaceAffiliates,
  getSettings, patchSettings, setAdminPassword, setAdminCredentials,
  buildDailyReport, etToday, markDailySent, applyClientCsvUpload, getClientRow, listActiveClients
} = require('../db');
const { sendDailyReport } = require('../email');
const { runDailySend } = require('../scheduler');

const router = express.Router();
router.use(requireAdmin);

router.get('/bootstrap', (req, res) => res.json(composeBootstrap()));

router.put('/plays', (req, res) => { replacePlays(req.body); res.json({ ok: true }); });
router.put('/trades', (req, res) => { replaceTrades(req.body); res.json({ ok: true }); });
router.put('/accounts', (req, res) => { replaceAccounts(req.body); res.json({ ok: true }); });
router.put('/clients', (req, res) => { replaceClients(req.body); res.json({ ok: true }); });
router.put('/dayPnl', (req, res) => { replaceDayPnl(req.body); res.json({ ok: true }); });
router.put('/affiliates', (req, res) => { replaceAffiliates(req.body); res.json({ ok: true }); });

router.patch('/settings', (req, res) => { patchSettings(req.body); res.json(getSettings()); });

router.post('/password', (req, res) => {
  const p = String((req.body && req.body.password) || '').trim();
  if (p.length < 6) return res.status(400).json({ error: 'Use at least 6 characters' });
  setAdminPassword(p);
  res.json({ ok: true });
});

router.post('/credentials', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (password && password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  setAdminCredentials({ username, password: password || undefined });
  res.json({ ok: true });
});

router.post('/clients/:id/daily-csv', (req, res) => {
  const row = getClientRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  const csv = String((req.body && req.body.csv) || '');
  try {
    const result = applyClientCsvUpload(req.params.id, csv);
    res.json({ ok: true, result, bootstrap: composeBootstrap() });
  } catch (e) {
    res.status(400).json({ error: e.message || 'CSV import failed' });
  }
});

router.post('/daily-csv', (req, res) => {
  const csv = String((req.body && req.body.csv) || '');
  const target = String((req.body && req.body.clientId) || 'all');
  try {
    const targets = target === 'all'
      ? listActiveClients()
      : [getClientRow(target)].filter(Boolean);
    if (!targets.length) return res.status(400).json({ error: 'No clients to apply CSV to.' });
    const results = targets.map(c => ({
      clientId: c.id,
      name: c.name,
      result: applyClientCsvUpload(c.id, csv)
    }));
    res.json({ ok: true, results, bootstrap: composeBootstrap() });
  } catch (e) {
    res.status(400).json({ error: e.message || 'CSV import failed' });
  }
});

router.post('/clients/:id/send', async (req, res) => {
  const date = (req.body && req.body.date) || null;
  const report = buildDailyReport(req.params.id, date);
  if (!report) return res.status(404).json({ error: 'Client not found' });
  try {
    await sendDailyReport(report);
    if (report.date === etToday()) markDailySent(report.clientId, report.date);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ error: 'Send failed: ' + e.message });
  }
});

router.post('/send-daily', async (req, res) => {
  const result = await runDailySend({ force: !!(req.body && req.body.force) });
  res.json(result);
});

module.exports = router;
