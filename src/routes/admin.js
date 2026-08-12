'use strict';
const express = require('express');
const { requireAdmin } = require('../auth');
const {
  composeBootstrap, replacePlays, replaceTrades, replaceAccounts, replaceClients,
  replaceDayPnl, replaceAffiliates,
  getSettings, patchSettings, setAdminPassword, setAdminCredentials,
  buildDailyReport, etToday, markDailySent,
  getDayScreenshot, saveDayScreenshot, deleteDayScreenshot,
  listDayTradeEntries, getDayTradeEntry, addDayTradeEntry, updateDayTradeEntry, deleteDayTradeEntry,
  ensureAdminShareToken
} = require('../db');
const { sendDailyReport } = require('../email');
const { runDailySend } = require('../scheduler');

const router = express.Router();
router.use(requireAdmin);

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

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

router.get('/share-link', (req, res) => {
  const token = ensureAdminShareToken(false);
  res.json({ token, path: '/share/' + token });
});
router.post('/share-link/rotate', (req, res) => {
  const token = ensureAdminShareToken(true);
  res.json({ token, path: '/share/' + token });
});

router.get('/day-shot/:date', (req, res) => {
  const shot = getDayScreenshot('admin', req.params.date);
  if (!shot) return res.status(404).json({ error: 'No screenshot' });
  res.setHeader('Content-Type', shot.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(shot.filePath);
});

router.get('/day-trades/:date', (req, res) => {
  res.json({ entries: listDayTradeEntries('admin', req.params.date) });
});

router.get('/day-trades/:date/:id', (req, res) => {
  const shot = getDayTradeEntry('admin', req.params.id);
  if (!shot) return res.status(404).json({ error: 'No screenshot' });
  res.setHeader('Content-Type', shot.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(shot.filePath);
});

router.post('/day-trades/:date', (req, res) => {
  try {
    const parsed = parseDataUrl(req.body && req.body.dataUrl);
    if (!parsed) return res.status(400).json({ error: 'Send a JPEG, PNG, or WebP image' });
    const entry = addDayTradeEntry('admin', req.params.date, {
      mime: parsed.mime,
      buffer: parsed.buffer,
      pnl: req.body && req.body.pnl
    });
    res.json({ ok: true, entry, dayPnl: composeBootstrap().dayPnl });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Upload failed' });
  }
});

router.patch('/day-trades/:date/:id', (req, res) => {
  try {
    const body = req.body || {};
    let parsed = null;
    if (body.dataUrl) {
      parsed = parseDataUrl(body.dataUrl);
      if (!parsed) return res.status(400).json({ error: 'Send a JPEG, PNG, or WebP image' });
    }
    const entry = updateDayTradeEntry('admin', req.params.id, {
      mime: parsed && parsed.mime,
      buffer: parsed && parsed.buffer,
      pnl: body.pnl
    });
    res.json({ ok: true, entry, dayPnl: composeBootstrap().dayPnl });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Update failed' });
  }
});

router.delete('/day-trades/:date/:id', (req, res) => {
  try {
    deleteDayTradeEntry('admin', req.params.id);
    res.json({ ok: true, dayPnl: composeBootstrap().dayPnl });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Delete failed' });
  }
});

router.put('/day-shot/:date', (req, res) => {
  try {
    const parsed = parseDataUrl(req.body && req.body.dataUrl);
    if (!parsed) return res.status(400).json({ error: 'Send a JPEG, PNG, or WebP image' });
    const entry = addDayTradeEntry('admin', req.params.date, { mime: parsed.mime, buffer: parsed.buffer, pnl: 0 });
    res.json({ ok: true, date: req.params.date, entry });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Upload failed' });
  }
});

router.delete('/day-shot/:date', (req, res) => {
  try {
    deleteDayScreenshot('admin', req.params.date);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Delete failed' });
  }
});

module.exports = router;
