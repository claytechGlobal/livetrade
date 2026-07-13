# LIVE TRADES — backend + portal

A production-oriented version of the LIVE TRADES managed-futures journal. It adds the things a static page can't do safely: a real server-side login, a database, role separation (admin vs. read-only client), and a Stripe webhook that **automatically activates a client's portal when their package payment succeeds**.

---

## What's included (feature summary)

**Packages:** Starter (2 accts, $99/mo), Pro (4 accts, $179/mo), Elite (6 accts, $299/mo), Prime (12 accts, $2,500). Set `LINK_PRIME` in `.env` to your real Stripe payment link.

**Trade Copier:** Central Upload distributes a day's P&L (with your profit-share %) to every active client in one action. Clients receive a read-only portal showing their own figures only.

**Playbook Guide:** 13 A+ move cards (Avoid/Take format) drawn from the playbook PDF, accessible under the Trading menu.

**Affiliates:** Partners earn 10% per referred sale. Each affiliate gets a unique referral link (`?ref=CODE`). Log referred sales manually; commission totals are computed live.

**Shareable portal links:** Copy a `?portal=ACCESS_CODE` URL per client to share their read-only dashboard directly.

**CSV import:** Paste CSV data from any platform on the Calendar page to bulk-populate the P&L calendar. Date and P&L columns are auto-detected; you can remap before importing.

**Daily reports (5 PM ET):** Scheduler emails each active client their day's P&L, MTD, total, and net after fee. Admin can Send now per client or trigger the full run via `POST /api/admin/send-daily`.

**Admin credentials:** Username + bcrypt-hashed password, configured via `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` or updated any time under Settings → Access & Security.

**Terms & Policy:** Template text accessible from the login footer and the sidebar nav (not legal advice — have a qualified attorney review before launch).

---

## Architecture

```
  ┌──────────────────────┐        ┌──────────────────────────┐
  │   Admin app          │        │   Client portal          │
  │   full access        │        │   read-only, gated        │
  └──────────┬───────────┘        └────────────┬─────────────┘
             │  cookie (JWT)                    │  cookie (JWT)
             └───────────────┬──────────────────┘
                             ▼
            ┌──────────────────────────────────────────┐
            │            Node + Express server          │
            │  ┌────────┐  ┌────────────┐  ┌──────────┐ │
            │  │ Auth   │  │ REST API   │  │ Stripe   │ │
            │  │ JWT +  │  │ role-gated │  │ webhook  │ │
            │  │ bcrypt │  │ routes     │  │ activates│ │
            │  └────────┘  └────────────┘  └────▲─────┘ │
            └───────────────┬─────────────────────┼──────┘
                            ▼                      │ checkout.session.completed
                  ┌───────────────────┐   ┌────────┴─────────┐
                  │  SQLite database  │   │  Stripe Checkout │
                  │  clients, trades, │   │  3 payment links │
                  │  daily_pnl, ...   │   └──────────────────┘
                  └───────────────────┘
        (on activation, the server emails the client their access code)
```

- **Admin** logs in with a password → full app (dashboard, trades, calendar, playbook, prop firms, clients, settings) and can upload daily P&L per client.
- **Client** logs in with an access code → only their own read-only portal (daily P&L, calendar, accounts, net after fee). No write access of any kind.
- **Stripe** payment links → `checkout.session.completed` webhook → the server activates the client (or creates one), generates an access code, and emails it.

---

## Project structure

```
live-trades-backend/
├── server.js              app entry: middleware, route mounting, static frontend
├── package.json
├── .env.example           copy to .env and fill in
├── src/
│   ├── db.js              SQLite schema, seeds, and all data/business logic
│   ├── auth.js            JWT cookie helpers + requireAdmin / requireClient
│   ├── email.js           optional SMTP sender for access codes
│   └── routes/
│       ├── auth.js        POST /login, /logout, GET /me
│       ├── admin.js       GET /bootstrap, bulk PUTs, settings, password   (admin only)
│       ├── client.js      GET /portal                                     (client only)
│       ├── public.js      GET /pricing                                    (no auth)
│       └── stripe.js      POST /webhook                                   (raw body)
└── public/
    └── index.html         the LIVE TRADES UI, wired to the API
```

---

## Setup

Requires **Node 18+**.

```bash
npm install
cp .env.example .env          # then edit .env (see below)
npm start                     # http://localhost:3000
```

On first run the server creates `data.sqlite`, seeds an admin from `ADMIN_PASSWORD`, and seeds default settings. To explore with sample clients/trades, set `SEED_DEMO=true` in `.env` for the first run (demo logins: admin password from `.env`, clients `MARC-7788` and `DANA-2255`).

### `.env` essentials

| Key | What it is |
|-----|------------|
| `JWT_SECRET` | Long random string that signs login cookies. **Required.** |
| `ADMIN_PASSWORD` | Your first-run admin password (change later in Settings). |
| `STRIPE_SECRET_KEY` | From Stripe → Developers → API keys. |
| `STRIPE_WEBHOOK_SECRET` | From the webhook endpoint you create (below). |
| `PRICE_STARTER/PRO/ELITE` | The Stripe **price IDs** (`price_…`) for each tier. |
| `LINK_STARTER/PRO/ELITE` | Your three payment-link URLs. |
| `PRICE_*_LABEL` | The price text shown on the public login screen. |
| `SMTP_*` | Optional. If blank, access codes are logged to the server console instead of emailed. |

---

## Stripe setup (auto-activation)

1. In Stripe, create one **Product + Price** per tier (Starter / Pro / Elite) and copy each price's API id (`price_…`) into `PRICE_STARTER/PRO/ELITE`.
2. Your three payment links are already in `.env.example`. (If you regenerate them, update `LINK_*`.)
3. Create a webhook: **Developers → Webhooks → Add endpoint**
   - URL: `https://YOUR_DOMAIN/api/stripe/webhook`
   - Event: `checkout.session.completed`
   - Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
4. Test locally with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   stripe trigger checkout.session.completed
   ```

### Two purchase flows, both handled

- **Pre-created client:** In the admin Clients tab, add the client (status = *Pending*), then use **Copy Checkout Link** — it appends `?client_reference_id=<clientId>`. When they pay, the webhook matches that id and flips exactly that client to *active*.
- **Open purchase from the pricing screen:** anyone can buy from the login page. With no `client_reference_id`, the webhook matches by email or creates a brand-new active client, then emails the access code.

The package tier is read from the price id on the completed session (`PRICE_*` map). Webhook events are de-duplicated by session id, so retries won't double-process.

---

## How the data flows

- The admin UI loads everything from `GET /api/admin/bootstrap` and saves each collection with a bulk `PUT /api/admin/<collection>` (plays, accounts, trades, clients). The server stores it relationally.
- Uploading daily P&L for a client writes into the `clients` payload; that drives the client's portal numbers and your management fee.
- The client portal calls only `GET /api/client/portal`, which returns **just that client's** record — there are no write endpoints exposed to client tokens.

---

## Daily client reports (auto-send at 5 PM ET)

Each active client can have their trading day uploaded by the admin (single day or bulk paste), and a scheduler emails each client their report **every day at 5:00 PM America/New_York**.

- The job lives in `src/scheduler.js` (uses `node-cron` with a timezone), started from `server.js`.
- It emails active clients today's P&L, month-to-date, total, and their net after the management fee, plus a link back to their dashboard. Sends are de-duplicated per client per day.
- Config in `.env`: `DAILY_SEND_ENABLED`, `DAILY_SEND_HOUR` (24h, default `17`), `DAILY_SEND_TZ` (default `America/New_York`), `DAILY_SEND_ONLY_WITH_DATA` (skip clients with no P&L uploaded that day).
- Manual triggers (admin only): `POST /api/admin/clients/:id/send` sends one client now; `POST /api/admin/send-daily` runs the whole 5 PM job on demand (`{ "force": true }` re-sends even if already sent today). The admin UI exposes a **Send now** button per client.
- Email delivery uses the `SMTP_*` settings; if SMTP is blank, reports are logged to the server console so you can verify the schedule before wiring a provider.

Clients only ever see their read-only dashboard — there are no client write endpoints.



- Put this behind HTTPS (a reverse proxy like Nginx/Caddy, or a host such as Render/Railway/Fly). Cookies are issued with `Secure` when `NODE_ENV=production`, so they require HTTPS.
- `data.sqlite` is your database file — back it up and mount it on a **persistent disk** (don't store it on an ephemeral filesystem).
- `app.set('trust proxy', 1)` is enabled for correct secure-cookie + rate-limit behaviour behind a proxy.

---

## What changed from the prototype (and why it's safer)

- Passwords are **bcrypt-hashed** and verified server-side; the admin password never round-trips to the browser.
- Sessions are signed **JWTs in httpOnly cookies**, so portal access can't be faked by editing page source.
- Clients are isolated server-side: a client token can only reach `/api/client/*`, which returns only their own data.
- Login is rate-limited; the Stripe webhook verifies signatures and ignores anything unsigned.

## Known limitations / suggested next steps

- **Bulk collection writes.** The admin app replaces a whole collection on save (simple, matches the existing UI). If a Stripe webhook creates a client at the exact moment the admin saves the clients list, the admin's save could overwrite it. For higher volume, move to granular endpoints (`POST/PATCH/DELETE /clients/:id`, `/daily-pnl`, etc.). The relational schema already supports this.
- **Access codes** are stored as plaintext shared secrets (so you can display/copy them to send to clients). If you prefer, hash them and show the plaintext only once at generation time.
- **Email** is optional/basic. Wire `SMTP_*` to a real provider (Postmark, SES, Resend) for production deliverability.
- **CSP** is disabled because the single-file UI uses inline styles/scripts. If you split the frontend into separate JS/CSS assets, turn Helmet's CSP back on.
# livetrade
