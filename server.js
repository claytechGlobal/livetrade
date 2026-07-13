'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { initDb } = require('./src/db');
const { startScheduler } = require('./src/scheduler');

const app = express();
initDb();
startScheduler();

app.use(helmet({ contentSecurityPolicy: false }));
app.disable('x-powered-by');
app.set('trust proxy', 1);

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

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`LIVE TRADES listening on http://localhost:${PORT}`));
}
module.exports = app;
