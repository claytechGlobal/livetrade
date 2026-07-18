'use strict';
const express = require('express');
const Stripe = require('stripe');
const { handleCheckout, isProcessed, markProcessed } = require('../db');
const { sendAccessCode } = require('../email');

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const priceMap = {};
if (process.env.PRICE_ACCESS) priceMap[process.env.PRICE_ACCESS] = 'access';
if (process.env.PRICE_STARTER) priceMap[process.env.PRICE_STARTER] = 'starter';
if (process.env.PRICE_PRO) priceMap[process.env.PRICE_PRO] = 'pro';
if (process.env.PRICE_ELITE) priceMap[process.env.PRICE_ELITE] = 'elite';
if (process.env.PRICE_PRIME) priceMap[process.env.PRICE_PRIME] = 'prime';

// IMPORTANT: this route must receive the RAW body for signature verification,
// so express.raw is applied here (and the global JSON parser is mounted AFTER this router in server.js).
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !WEBHOOK_SECRET) return res.status(500).send('Stripe is not configured on the server.');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (isProcessed(session.id)) return res.json({ received: true, duplicate: true });

    let packageKey = null;
    try {
      const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
      const priceId = items.data[0] && items.data[0].price && items.data[0].price.id;
      packageKey = priceMap[priceId] || null;
    } catch (_) { /* price lookup is best-effort */ }

    const client = handleCheckout({
      sessionId: session.id,
      ref: session.client_reference_id,
      email: (session.customer_details && session.customer_details.email) || session.customer_email,
      name: (session.customer_details && session.customer_details.name) || '',
      packageKey
    });
    markProcessed(session.id);

    if (client) {
      sendAccessCode(client).catch(e => console.error('[email] failed:', e.message));
      console.log(`[stripe] Activated client ${client.id} (${client.email || client.name}) on package "${client.package}".`);
    }
  }

  res.json({ received: true });
});

module.exports = router;
