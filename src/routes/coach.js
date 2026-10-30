'use strict';
const express = require('express');
const { requireCoach } = require('../auth');
const { addClientManual, listClientsByCreator } = require('../db');
const { sendAccessCode } = require('../email');

const router = express.Router();
router.use(requireCoach);

router.get('/clients', (req, res) => {
  res.json({ clients: listClientsByCreator(req.user.staffId) });
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
