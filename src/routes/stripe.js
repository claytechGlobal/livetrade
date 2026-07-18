'use strict';
const express = require('express');
const Stripe = require('stripe');
const {
  handleCheckout, extendClientAccess, expireClientBySubscription,
  isProcessed, markProcessed
} = require('../db');
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

function unixToIso(sec) {
  if (!sec) return null;
  return new Date(Number(sec) * 1000).toISOString();
}

async function resolvePackageKey(session) {
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    const priceId = items.data[0] && items.data[0].price && items.data[0].price.id;
    if (priceId && priceMap[priceId]) return priceMap[priceId];
  } catch (_) { /* best-effort */ }
  if (session.mode === 'subscription') return 'access';
  return null;
}

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !WEBHOOK_SECRET) return res.status(500).send('Stripe is not configured on the server.');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (isProcessed(session.id)) return res.json({ received: true, duplicate: true });

      const packageKey = await resolvePackageKey(session);
      let expiresAt = null;
      let subscriptionId = null;

      if (session.mode === 'subscription' || packageKey === 'access') {
        subscriptionId = typeof session.subscription === 'string'
          ? session.subscription
          : (session.subscription && session.subscription.id) || null;
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            expiresAt = unixToIso(sub.current_period_end);
            subscriptionId = sub.id;
          } catch (_) {
            expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
          }
        } else {
          expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
        }
      }

      const client = handleCheckout({
        sessionId: session.id,
        ref: session.client_reference_id,
        email: (session.customer_details && session.customer_details.email) || session.customer_email,
        name: (session.customer_details && session.customer_details.name) || '',
        packageKey: packageKey || (session.mode === 'subscription' ? 'access' : 'starter'),
        expiresAt,
        subscriptionId
      });
      markProcessed(session.id);

      if (client) {
        sendAccessCode(client).catch(e => console.error('[email] failed:', e.message));
        console.log(`[stripe] Activated ${client.id} (${client.email || client.name}) pkg=${client.package} exp=${client.access_expires_at || 'none'}`);
      }
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      if (invoice.billing_reason === 'subscription_create') {
        return res.json({ received: true, skipped: 'handled by checkout' });
      }
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
      if (!subId) return res.json({ received: true });
      if (isProcessed('inv:' + invoice.id)) return res.json({ received: true, duplicate: true });

      let expiresAt = null;
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        expiresAt = unixToIso(sub.current_period_end);
      } catch (_) {
        expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
      }

      const email = (invoice.customer_email) || null;
      const client = extendClientAccess(email, expiresAt, subId);
      markProcessed('inv:' + invoice.id);
      if (client) console.log(`[stripe] Renewed access for ${client.id} until ${expiresAt}`);
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      if (isProcessed('subdel:' + sub.id)) return res.json({ received: true, duplicate: true });
      const client = expireClientBySubscription(sub.id);
      markProcessed('subdel:' + sub.id);
      if (client) console.log(`[stripe] Expired access for ${client.id} (subscription canceled)`);
    }
  } catch (e) {
    console.error('[stripe] webhook handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }

  res.json({ received: true });
});

module.exports = router;
