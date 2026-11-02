'use strict';
const express = require('express');
const { requireCoach } = require('../auth');
const { addClientManual, listClientsByCreator, getCoachJournal, listCoachWeeklyNotes, getTradeChart, getDayTradeEntry, listCoachCopier, saveCoachCopier, buildDailyReport, markDailySent, etToday } = require('../db');
const { sendAccessCode, sendDailyReport } = require('../email');

const router = express.Router();
router.use(requireCoach);

router.get('/clients', (req, res) => {
  res.json({ clients: listClientsByCreator(req.user.staffId) });
});

router.get('/reviews', (req, res) => {
  res.json({ notes: listCoachWeeklyNotes(req.user.staffId) });
});

router.get('/clients/:id/journal', (req, res) => {
  const app = getCoachJournal(req.user.staffId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Client not found' });
  res.json(app);
});

router.get('/clients/:id/chart/:tradeId', (req, res) => {
  const app = getCoachJournal(req.user.staffId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Client not found' });
  const shot = getTradeChart(req.params.id, req.params.tradeId);
  if (!shot) return res.status(404).json({ error: 'No chart' });
  res.setHeader('Content-Type', shot.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(shot.filePath);
});

router.get('/clients/:id/day-trades/:date/:entryId', (req, res) => {
  const app = getCoachJournal(req.user.staffId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Client not found' });
  const shot = getDayTradeEntry(req.params.id, req.params.entryId);
  if (!shot) return res.status(404).json({ error: 'No screenshot' });
  res.setHeader('Content-Type', shot.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(shot.filePath);
});

router.get('/copier', (req, res) => {
  res.json({ clients: listCoachCopier(req.user.staffId) });
});

router.put('/copier', (req, res) => {
  try {
    const clients = saveCoachCopier(req.user.staffId, req.body);
    res.json({ ok: true, clients });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save.' });
  }
});

router.post('/clients/:id/send', async (req, res) => {
  const mine = listCoachCopier(req.user.staffId).some(c => c.id === req.params.id);
  if (!mine) return res.status(404).json({ error: 'Client not found' });
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

router.post('/clients', async (req, res) => {
  try {
    const body = req.body || {};
    const client = addClientManual({
      name: body.name,
      email: body.email,
      package: body.package,
      split: body.split,
      createdBy: req.user.staffId
    });
    let emailed = false;
    try {
      await sendAccessCode(client, { force: true });
      emailed = true;
    } catch (err) {
      console.error('[email] coach client:', err.message);
    }
    res.json({
      ok: true,
      emailed,
      client: {
        id: client.id, name: client.name, email: client.email, package: client.package,
        status: client.status, accessCode: client.access_code
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not add client.' });
  }
});

module.exports = router;
