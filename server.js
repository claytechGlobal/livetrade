'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { initDb } = require('./src/db');
const { startScheduler, runDailySend } = require('./src/scheduler');

const app = express();

try {
  initDb();
} catch (e) {
  console.error('[boot] initDb failed:', e);
}

const onVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
if (onVercel) {
  console.log('[scheduler] skipped on Vercel — use Cron → /api/cron/daily');
} else {
  startScheduler();
}

app.use(helmet({ contentSecurityPolicy: false }));
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, vercel: onVercel, time: new Date().toISOString() });
});

app.get('/api/cron/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const auth = req.headers.authorization || '';
  if (!secret || auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runDailySend({ force: false });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Cron failed' });
  }
});

app.use('/api/stripe', require('./src/routes/stripe'));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/public', require('./src/routes/public'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/client', require('./src/routes/client'));

const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`LIVE TRADES listening on http://localhost:${PORT}`));
}
module.exports = app;
