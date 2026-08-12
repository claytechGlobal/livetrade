'use strict';
const express = require('express');
const { requireClient } = require('../auth');
const { getClientPortal, getClientRow, getSettings, composeClientApp, applyClientCsvUpload, saveClientTrades, saveClientAccounts, saveClientPlays, getDayScreenshot, saveDayScreenshot, deleteDayScreenshot, listDayTradeEntries, getDayTradeEntry, addDayTradeEntry, updateDayTradeEntry, deleteDayTradeEntry, ensureClientShareToken } = require('../db');
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

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

router.get('/day-shot/:date', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  const shot = getDayScreenshot(row.id, req.params.date);
  if (!shot) return res.status(404).json({ error: 'No screenshot' });
  res.setHeader('Content-Type', shot.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(shot.filePath);
});

router.get('/day-trades/:date', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  res.json({ entries: listDayTradeEntries(row.id, req.params.date) });
});

router.get('/day-trades/:date/:id', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  const shot = getDayTradeEntry(row.id, req.params.id);
  if (!shot) return res.status(404).json({ error: 'No screenshot' });
  res.setHeader('Content-Type', shot.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(shot.filePath);
});

router.post('/day-trades/:date', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  try {
    const parsed = parseDataUrl(req.body && req.body.dataUrl);
    if (!parsed) return res.status(400).json({ error: 'Send a JPEG, PNG, or WebP image' });
    const entry = addDayTradeEntry(row.id, req.params.date, {
      mime: parsed.mime,
      buffer: parsed.buffer,
      pnl: req.body && req.body.pnl
    });
    const data = composeClientApp(row.id);
    res.json({ ok: true, entry, dayPnl: data.dayPnl, dayTrades: data.dayTrades });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Upload failed' });
  }
});

router.patch('/day-trades/:date/:id', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  try {
    const body = req.body || {};
    let parsed = null;
    if (body.dataUrl) {
      parsed = parseDataUrl(body.dataUrl);
      if (!parsed) return res.status(400).json({ error: 'Send a JPEG, PNG, or WebP image' });
    }
    const entry = updateDayTradeEntry(row.id, req.params.id, {
      mime: parsed && parsed.mime,
      buffer: parsed && parsed.buffer,
      pnl: body.pnl
    });
    const data = composeClientApp(row.id);
    res.json({ ok: true, entry, dayPnl: data.dayPnl, dayTrades: data.dayTrades });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Update failed' });
  }
});

router.delete('/day-trades/:date/:id', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  try {
    deleteDayTradeEntry(row.id, req.params.id);
    const data = composeClientApp(row.id);
    res.json({ ok: true, dayPnl: data.dayPnl, dayTrades: data.dayTrades });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Delete failed' });
  }
});

router.put('/day-shot/:date', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  try {
    const parsed = parseDataUrl(req.body && req.body.dataUrl);
    if (!parsed) return res.status(400).json({ error: 'Send a JPEG, PNG, or WebP image' });
    const entry = addDayTradeEntry(row.id, req.params.date, { mime: parsed.mime, buffer: parsed.buffer, pnl: 0 });
    res.json({ ok: true, date: req.params.date, entry });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Upload failed' });
  }
});

router.delete('/day-shot/:date', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  try {
    deleteDayScreenshot(row.id, req.params.date);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Delete failed' });
  }
});

router.get('/share-link', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  const token = ensureClientShareToken(row.id, false);
  res.json({ token, path: '/share/' + token });
});
router.post('/share-link/rotate', (req, res) => {
  const row = req.clientRow || getClientRow(req.user.clientId);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!assertSubscribed(row, res)) return;
  const token = ensureClientShareToken(row.id, true);
  res.json({ token, path: '/share/' + token });
});

module.exports = router;
