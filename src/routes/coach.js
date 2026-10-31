'use strict';
const express = require('express');
const { requireCoach } = require('../auth');
const { addClientManual, listClientsByCreator, getCoachJournal, listCoachWeeklyNotes, getTradeChart, getDayTradeEntry } = require('../db');
const { sendAccessCode } = require('../email');

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
