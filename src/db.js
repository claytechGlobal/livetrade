'use strict';
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

function resolveDbPath() {
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'livetrades.sqlite');
  }
  return path.join(__dirname, '..', 'data.sqlite');
}

const DB_PATH = resolveDbPath();
console.log('[db] path', DB_PATH);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ---------- helpers ---------- */
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex');
}
function genCode(name) {
  const base = String(name || '').replace(/[^a-z]/gi, '').slice(0, 4).toUpperCase() || 'CLNT';
  return base + '-' + Math.floor(1000 + Math.random() * 9000);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function num(x) {
  const n = Number(x);
  return isNaN(n) ? 0 : n;
}
function nullableNum(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return isNaN(n) ? null : n;
}

/* ---------- schema ---------- */
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS plays (id TEXT PRIMARY KEY, name TEXT, color TEXT, description TEXT);
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, package TEXT, status TEXT,
      split REAL, access_code TEXT, stripe_session_id TEXT, joined TEXT
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, client_id TEXT, firm TEXT, label TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS account_expenses (
      id TEXT PRIMARY KEY, account_id TEXT, type TEXT, amount REAL, date TEXT
    );
    CREATE TABLE IF NOT EXISTS account_payouts (
      id TEXT PRIMARY KEY, account_id TEXT, amount REAL, date TEXT
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY, account_id TEXT, play_id TEXT, symbol TEXT, date TEXT,
      direction TEXT, entry REAL, exit REAL, stop REAL, contracts REAL,
      emotion TEXT, plan INTEGER, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS daily_pnl (
      id TEXT PRIMARY KEY, client_id TEXT, date TEXT, amount REAL, note TEXT
    );
    CREATE TABLE IF NOT EXISTS affiliates (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, code TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS affiliate_sales (
      id TEXT PRIMARY KEY, affiliate_id TEXT, package TEXT, amount REAL, date TEXT
    );
    CREATE TABLE IF NOT EXISTS processed_events (id TEXT PRIMARY KEY, created_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_acc_client ON accounts(client_id);
    CREATE INDEX IF NOT EXISTS idx_daily_client ON daily_pnl(client_id);
    CREATE INDEX IF NOT EXISTS idx_aff_sales ON affiliate_sales(affiliate_id);
    CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
  `);

  // migrate older databases that predate the username column
  const adminCols = db.prepare('PRAGMA table_info(admins)').all().map(c => c.name);
  if (!adminCols.includes('username')) db.exec('ALTER TABLE admins ADD COLUMN username TEXT');
  db.prepare("UPDATE admins SET username = ? WHERE username IS NULL OR username = ''").run(process.env.ADMIN_USERNAME || 'admin');

  if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) {
    const user = process.env.ADMIN_USERNAME || 'admin';
    const pw = process.env.ADMIN_PASSWORD || 'admin';
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(user, bcrypt.hashSync(pw, 10));
    console.log('[db] Seeded admin account from ADMIN_USERNAME / ADMIN_PASSWORD.');
  }

  if (!getSetting('appName')) {
    setSetting('appName', 'LIVE TRADES');
    setSetting('accent', '#22b8ef');
    setSetting('trader', 'Trader');
    setSetting('prices', JSON.stringify({
      access: process.env.PRICE_ACCESS_LABEL || '$45/mo',
      starter: process.env.PRICE_STARTER_LABEL || '$500',
      pro: process.env.PRICE_PRO_LABEL || '$1000',
      elite: process.env.PRICE_ELITE_LABEL || '$1500',
      prime: process.env.PRICE_PRIME_LABEL || '$2500'
    }));
    setSetting('liveSessionUrl', process.env.LIVE_SESSION_URL || '');
    setSetting('liveSessionEnabled', process.env.LIVE_SESSION_ENABLED !== 'false' ? 'true' : 'false');
  }

  migratePackagePrices();
  if (getSetting('liveSessionEnabled') === null || getSetting('liveSessionEnabled') === undefined) {
    setSetting('liveSessionEnabled', 'true');
  }
  if (!getSetting('liveSessionUrl')) setSetting('liveSessionUrl', process.env.LIVE_SESSION_URL || '');

  const accCols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  if (!accCols.includes('account_size')) db.exec('ALTER TABLE accounts ADD COLUMN account_size TEXT');
  if (!accCols.includes('parent_account_id')) db.exec('ALTER TABLE accounts ADD COLUMN parent_account_id TEXT');
  ensureClientTradesTable();
  const tradeCols = db.prepare('PRAGMA table_info(trades)').all().map(c => c.name);
  if (!tradeCols.includes('play_name')) db.exec('ALTER TABLE trades ADD COLUMN play_name TEXT');
  migrateAccountLineage();

  if (process.env.SEED_DEMO === 'true' && !db.prepare('SELECT id FROM clients LIMIT 1').get()) {
    seedDemo();
    console.log('[db] Loaded demo data (SEED_DEMO=true).');
  }
}
function mapAccountRow(a) {
  return {
    id: a.id, firm: a.firm, label: a.label, status: a.status, clientId: a.client_id,
    accountSize: a.account_size || '', parentAccountId: a.parent_account_id || null,
    expenses: db.prepare('SELECT * FROM account_expenses WHERE account_id=?').all(a.id)
      .map(e => ({ id: e.id, type: e.type, amount: e.amount, date: e.date })),
    payouts: db.prepare('SELECT * FROM account_payouts WHERE account_id=?').all(a.id)
      .map(p => ({ id: p.id, amount: p.amount, date: p.date }))
  };
}
function insertAccountRow(a) {
  const st = String(a.status || 'evaluation').toLowerCase();
  const status = ['evaluation', 'funded', 'payout', 'failed'].includes(st) ? st : 'evaluation';
  const size = a.accountSize || parseAcctSizeFromLabel(a.label) || '';
  db.prepare('INSERT INTO accounts(id,client_id,firm,label,status,account_size,parent_account_id) VALUES(?,?,?,?,?,?,?)')
    .run(a.id || uid(), a.clientId || null, a.firm || '', a.label || 'Account', status, size, a.parentAccountId || null);
}
function parseAcctSizeFromLabel(label) {
  const m = String(label || '').match(/(\d+)\s*K/i);
  return m ? `${m[1]}K` : '';
}
function migratePackagePrices() {
  let p = {};
  try { p = JSON.parse(getSetting('prices') || '{}'); } catch (_) { p = {}; }
  const next = {
    access: '$45/mo',
    starter: '$500',
    pro: '$1000',
    elite: '$1500',
    prime: '$2500'
  };
  const old = {
    access: ['', null],
    starter: ['$99/mo', '$99', '$500/mo'],
    pro: ['$179/mo', '$179', '$1000/mo'],
    elite: ['$299/mo', '$299', '$1500/mo'],
    prime: ['$—', '', '$2500/mo']
  };
  let changed = false;
  Object.keys(next).forEach(k => {
    if (!p[k] || (old[k] && old[k].includes(p[k]))) {
      p[k] = process.env['PRICE_' + k.toUpperCase() + '_LABEL'] || next[k];
      changed = true;
    }
  });
  if (changed) setSetting('prices', JSON.stringify(p));
}
function migrateAccountLineage() {
  const accs = db.prepare('SELECT * FROM accounts').all();
  accs.forEach(a => {
    const size = a.account_size || parseAcctSizeFromLabel(a.label);
    if (size && !a.account_size) db.prepare('UPDATE accounts SET account_size=? WHERE id=?').run(size, a.id);
    if (/eval/i.test(a.label) && a.status === 'funded') db.prepare('UPDATE accounts SET status=? WHERE id=?').run('evaluation', a.id);
  });
  const rows = db.prepare('SELECT * FROM accounts').all();
  rows.forEach(ev => {
    if (!/eval/i.test(ev.label) && ev.status !== 'evaluation') return;
    const sz = ev.account_size || parseAcctSizeFromLabel(ev.label);
    const funded = rows.find(f => f.id !== ev.id && f.client_id === ev.client_id && f.firm === ev.firm
      && (f.account_size || parseAcctSizeFromLabel(f.label)) === sz
      && (f.status === 'funded' || f.status === 'payout') && !f.parent_account_id);
    if (funded) db.prepare('UPDATE accounts SET parent_account_id=? WHERE id=?').run(ev.id, funded.id);
  });
}

/* ---------- settings ---------- */
function getSetting(k) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  return r ? r.value : null;
}
function setSetting(k, v) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
}
function getSettings() {
  const o = {};
  db.prepare('SELECT * FROM settings').all().forEach(r => { o[r.key] = r.value; });
  if (o.prices) { try { o.prices = JSON.parse(o.prices); } catch (_) { o.prices = {}; } }
  else o.prices = {};
  o.liveSessionUrl = o.liveSessionUrl || '';
  o.liveSessionEnabled = o.liveSessionEnabled !== 'false';
  return o;
}
function patchSettings(obj) {
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (k === 'adminPass') return; // never store the admin password in settings
    setSetting(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
}
function setAdminPassword(pw) {
  const hash = bcrypt.hashSync(pw, 10);
  const a = db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (a) db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(hash, a.id);
  else db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(process.env.ADMIN_USERNAME || 'admin', hash);
}
function setAdminCredentials({ username, password }) {
  const a = db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (!a) {
    db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)')
      .run((username || 'admin').trim(), bcrypt.hashSync(password || 'admin', 10));
    return;
  }
  if (username && username.trim()) db.prepare('UPDATE admins SET username=? WHERE id=?').run(username.trim(), a.id);
  if (password && password.length) db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), a.id);
}
function getAdminUsername() {
  const a = db.prepare('SELECT username FROM admins LIMIT 1').get();
  return a ? a.username : 'admin';
}
function verifyAdmin(username, password) {
  const a = db.prepare('SELECT * FROM admins WHERE lower(username)=lower(?)').get(String(username || '').trim());
  if (!a) return false;
  return bcrypt.compareSync(password, a.password_hash);
}

/* ---------- compose (read) ---------- */
function clientOut(c) {
  return {
    id: c.id, name: c.name, email: c.email, package: c.package, status: c.status,
    split: c.split, accessCode: c.access_code, joined: c.joined,
    dailyPnl: db.prepare('SELECT * FROM daily_pnl WHERE client_id=? ORDER BY date').all(c.id)
      .map(d => ({ id: d.id, date: d.date, amount: d.amount, note: d.note }))
  };
}
function composeBootstrap() {
  const plays = db.prepare('SELECT * FROM plays').all()
    .map(p => ({ id: p.id, name: p.name, color: p.color, desc: p.description }));
  const accounts = db.prepare('SELECT * FROM accounts').all().map(mapAccountRow);
  const trades = db.prepare('SELECT * FROM trades').all().map(t => ({
    id: t.id, accountId: t.account_id, playId: t.play_id, playName: t.play_name || '',
    symbol: t.symbol, date: t.date,
    direction: t.direction, entry: t.entry, exit: t.exit, stop: t.stop, contracts: t.contracts,
    emotion: t.emotion, plan: !!t.plan, notes: t.notes
  }));
  const clients = db.prepare('SELECT * FROM clients').all().map(clientOut);
  db.exec(`CREATE TABLE IF NOT EXISTS admin_day_pnl (id TEXT PRIMARY KEY, date TEXT, amount REAL, note TEXT)`);
  const dayPnl = db.prepare('SELECT * FROM admin_day_pnl ORDER BY date DESC').all()
    .map(r => ({ id: r.id, date: r.date, amount: r.amount, note: r.note || '' }));
  // affiliates with their referred sales
  const affiliates = db.prepare('SELECT * FROM affiliates ORDER BY name').all().map(a => ({
    id: a.id, name: a.name, email: a.email || '', code: a.code || '',
    sales: db.prepare('SELECT * FROM affiliate_sales WHERE affiliate_id=? ORDER BY date DESC').all(a.id)
      .map(s => ({ id: s.id, package: s.package, amount: s.amount, date: s.date }))
  }));
  const settings = getSettings();
  settings.adminUser = getAdminUsername();
  return { settings, plays, accounts, trades, clients, dayPnl, affiliates };
}
function getClientPortal(id) {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  if (!c) return null;
  const out = clientOut(c);
  out.accounts = db.prepare('SELECT * FROM accounts WHERE client_id=?').all(id)
    .map(a => ({
      id: a.id, firm: a.firm, label: a.label, status: a.status, clientId: a.client_id,
      accountSize: a.account_size || '', parentAccountId: a.parent_account_id || null
    }));
  return out;
}
function ensureClientTradesTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS client_trades (
    id TEXT PRIMARY KEY, client_id TEXT, symbol TEXT, date TEXT,
    direction TEXT, entry REAL, exit REAL, stop REAL, contracts REAL,
    pnl REAL, notes TEXT, play_id TEXT, account_id TEXT, emotion TEXT, plan INTEGER
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_client_trades ON client_trades(client_id)`);
  const cols = db.prepare('PRAGMA table_info(client_trades)').all().map(c => c.name);
  if (!cols.includes('play_id')) db.exec('ALTER TABLE client_trades ADD COLUMN play_id TEXT');
  if (!cols.includes('account_id')) db.exec('ALTER TABLE client_trades ADD COLUMN account_id TEXT');
  if (!cols.includes('emotion')) db.exec('ALTER TABLE client_trades ADD COLUMN emotion TEXT');
  if (!cols.includes('plan')) db.exec('ALTER TABLE client_trades ADD COLUMN plan INTEGER');
  if (!cols.includes('play_name')) db.exec('ALTER TABLE client_trades ADD COLUMN play_name TEXT');
}
function listClientTrades(clientId) {
  ensureClientTradesTable();
  return db.prepare('SELECT * FROM client_trades WHERE client_id=? ORDER BY date DESC').all(clientId).map(t => ({
    id: t.id, accountId: t.account_id || null, playId: t.play_id || null, playName: t.play_name || '',
    symbol: t.symbol, date: t.date,
    direction: t.direction, entry: t.entry, exit: t.exit, stop: t.stop,
    contracts: t.contracts, emotion: t.emotion || null, plan: t.plan !== 0, notes: t.notes || '',
    csvPnl: t.pnl
  }));
}
const replaceClientDailyPnl = db.transaction((clientId, entries) => {
  db.prepare('DELETE FROM daily_pnl WHERE client_id=?').run(clientId);
  const ins = db.prepare('INSERT INTO daily_pnl(id,client_id,date,amount,note) VALUES(?,?,?,?,?)');
  (entries || []).forEach(e => ins.run(e.id || uid(), clientId, e.date || today(), num(e.amount), e.note || ''));
});
const replaceClientTrades = db.transaction((clientId, trades) => {
  ensureClientTradesTable();
  db.prepare('DELETE FROM client_trades WHERE client_id=?').run(clientId);
  const ins = db.prepare(`INSERT INTO client_trades
    (id,client_id,symbol,date,direction,entry,exit,stop,contracts,pnl,notes,play_id,account_id,emotion,plan,play_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  (trades || []).forEach(t => {
    const pnl = t.csvPnl != null && t.csvPnl !== '' ? nullableNum(t.csvPnl) : nullableNum(t.pnl);
    ins.run(
      t.id || uid(), clientId, t.symbol || '', t.date || today(),
      t.direction || 'Long', num(t.entry), num(t.exit), nullableNum(t.stop),
      num(t.contracts) || 1, pnl, t.notes || '',
      t.playId || null, t.accountId || null, t.emotion || null, t.plan === false ? 0 : 1,
      t.playName || null
    );
  });
});
const replaceClientAccounts = db.transaction((clientId, accounts) => {
  const old = db.prepare('SELECT id FROM accounts WHERE client_id=?').all(clientId);
  old.forEach(r => {
    db.prepare('DELETE FROM account_expenses WHERE account_id=?').run(r.id);
    db.prepare('DELETE FROM account_payouts WHERE account_id=?').run(r.id);
  });
  db.prepare('DELETE FROM accounts WHERE client_id=?').run(clientId);
  const ie = db.prepare('INSERT INTO account_expenses(id,account_id,type,amount,date) VALUES(?,?,?,?,?)');
  const ip = db.prepare('INSERT INTO account_payouts(id,account_id,amount,date) VALUES(?,?,?,?)');
  (accounts || []).forEach(a => {
    const aid = a.id || uid();
    insertAccountRow({ ...a, id: aid, clientId });
    (a.expenses || []).forEach(e => ie.run(e.id || uid(), aid, e.type || 'Fee', num(e.amount), e.date || today()));
    (a.payouts || []).forEach(p => ip.run(p.id || uid(), aid, num(p.amount), p.date || today()));
  });
});
function saveClientPlays(plays) {
  replacePlays(plays);
}
function saveClientTrades(clientId, trades) {
  replaceClientTrades(clientId, trades);
  const byDay = {};
  (trades || []).forEach(t => {
    const date = t.date || today();
    let pnl = t.csvPnl != null && t.csvPnl !== '' ? Number(t.csvPnl) : Number(t.pnl);
    if (isNaN(pnl)) pnl = 0;
    byDay[date] = (byDay[date] || 0) + pnl;
  });
  const days = Object.keys(byDay).sort();
  replaceClientDailyPnl(clientId, days.map(date => ({
    id: uid(), date, amount: byDay[date], note: 'Client trades'
  })));
  return composeClientApp(clientId);
}
function saveClientAccounts(clientId, accounts) {
  replaceClientAccounts(clientId, accounts);
  return composeClientApp(clientId);
}
function parseTradeDay(raw) {
  let d = String(raw || '').trim();
  if (!d) return null;
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thu|fri|sat|sun)\b/i.test(d) && !/\d{4}/.test(d)) {
    return null;
  }
  const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const t = Date.parse(d);
  if (!isNaN(t)) {
    const x = new Date(t);
    if (!isNaN(x.getTime())) {
      const y = x.getFullYear();
      const mo = String(x.getMonth() + 1).padStart(2, '0');
      const da = String(x.getDate()).padStart(2, '0');
      return `${y}-${mo}-${da}`;
    }
  }
  return null;
}
function normalizeCsvSymbol(raw) {
  let sym = String(raw || 'ES').toUpperCase().trim();
  if (!sym) return 'ES';
  if (/^[A-Z]{6,10}$/.test(sym)) return sym;
  const root = sym.replace(/[A-Z]\d+$/, '').replace(/(\d+)$/, '').replace(/^([A-Z]{1,5}).*/, '$1');
  return root || sym;
}
function applyClientCsvUpload(clientId, csvText) {
  const clean = String(csvText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.trim().split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one trade.');
  function parseLine(l) {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, ''));
  const idx = (re) => headers.findIndex(h => re.test(h));
  const iDay = idx(/tradeday|^date$/);
  const iEntered = idx(/enteredat|entrytime|opentime|openat/);
  const iExited = idx(/exitedat|exittime|closetime|closeat/);
  const iPnl = idx(/^pnl$|profit|netp/);
  const iSym = idx(/contractname|contract|symbol|ticker|instrument/);
  const iDir = idx(/^type$|side|dir|buysell/);
  const iEntry = idx(/entryprice|entry/);
  const iExit = idx(/exitprice|exit/);
  const iSize = idx(/^size$|qty|quantity|contracts|lots/);
  if (iPnl < 0) throw new Error('CSV must include a PnL column.');
  if (iDay < 0 && iEntered < 0 && iExited < 0) {
    throw new Error('CSV must include TradeDay or EnteredAt (date) column.');
  }
  const byDay = {};
  const trades = [];
  lines.slice(1).forEach(line => {
    if (!line.trim()) return;
    const cols = parseLine(line);
    let date = null;
    if (iEntered >= 0) date = parseTradeDay(cols[iEntered]);
    if (!date && iExited >= 0) date = parseTradeDay(cols[iExited]);
    if (!date && iDay >= 0) date = parseTradeDay(cols[iDay]);
    const pnl = Number(String(cols[iPnl] || '').replace(/[$,]/g, ''));
    if (!date || isNaN(pnl)) return;
    byDay[date] = (byDay[date] || 0) + pnl;
    const sym = normalizeCsvSymbol(iSym >= 0 ? cols[iSym] : 'ES');
    const dirRaw = (iDir >= 0 ? cols[iDir] : '') || '';
    const direction = /sh|short|sell/i.test(dirRaw) ? 'Short' : 'Long';
    const qty = iSize >= 0 ? num(cols[iSize]) : 1;
    trades.push({
      id: uid(), symbol: sym, date, direction,
      entry: iEntry >= 0 ? num(cols[iEntry]) : 0,
      exit: iExit >= 0 ? num(cols[iExit]) : 0,
      contracts: qty > 0 ? qty : 1,
      stop: null, pnl, notes: 'CSV upload'
    });
  });
  const days = Object.keys(byDay).sort();
  if (!days.length) throw new Error('No valid trades found in CSV. Need date (EnteredAt or TradeDay as YYYY-MM-DD) and PnL.');
  replaceClientDailyPnl(clientId, days.map(date => ({
    id: uid(), date, amount: byDay[date], note: 'CSV upload'
  })));
  replaceClientTrades(clientId, trades);
  return { days: days.length, trades: trades.length, totalPnl: days.reduce((s, d) => s + byDay[d], 0) };
}
function composeClientApp(clientId) {
  const full = composeBootstrap();
  const client = getClientPortal(clientId);
  if (!client) return null;
  const mine = db.prepare('SELECT * FROM accounts WHERE client_id=?').all(clientId).map(mapAccountRow);
  return {
    settings: {
      appName: full.settings.appName,
      accent: full.settings.accent,
      trader: client.name || full.settings.trader,
      prices: full.settings.prices,
      liveSessionUrl: full.settings.liveSessionUrl || '',
      liveSessionEnabled: full.settings.liveSessionEnabled !== false
    },
    plays: full.plays,
    trades: listClientTrades(clientId),
    dayPnl: (client.dailyPnl || []).map(d => ({ id: d.id, date: d.date, amount: d.amount, note: d.note || '' })),
    accounts: mine,
    client
  };
}

/* ---------- bulk replace (admin writes) ---------- */
const replacePlays = db.transaction(arr => {
  db.prepare('DELETE FROM plays').run();
  const ins = db.prepare('INSERT INTO plays(id,name,color,description) VALUES(?,?,?,?)');
  (arr || []).forEach(p => ins.run(p.id || uid(), p.name || '', p.color || '#22b8ef', p.desc || p.description || ''));
});
const replaceTrades = db.transaction(arr => {
  db.prepare('DELETE FROM trades').run();
  const ins = db.prepare(`INSERT INTO trades
    (id,account_id,play_id,symbol,date,direction,entry,exit,stop,contracts,emotion,plan,notes,play_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  (arr || []).forEach(t => ins.run(
    t.id || uid(), t.accountId || null, t.playId || null, t.symbol || '', t.date || today(),
    t.direction || 'Long', num(t.entry), num(t.exit), nullableNum(t.stop), num(t.contracts) || 1,
    t.emotion || null, t.plan ? 1 : 0, t.notes || '', t.playName || null));
});
const replaceAccounts = db.transaction(arr => {
  db.prepare('DELETE FROM accounts').run();
  db.prepare('DELETE FROM account_expenses').run();
  db.prepare('DELETE FROM account_payouts').run();
  const ie = db.prepare('INSERT INTO account_expenses(id,account_id,type,amount,date) VALUES(?,?,?,?,?)');
  const ip = db.prepare('INSERT INTO account_payouts(id,account_id,amount,date) VALUES(?,?,?,?)');
  (arr || []).forEach(a => {
    const aid = a.id || uid();
    insertAccountRow({ ...a, id: aid });
    (a.expenses || []).forEach(e => ie.run(e.id || uid(), aid, e.type || 'Fee', num(e.amount), e.date || today()));
    (a.payouts || []).forEach(p => ip.run(p.id || uid(), aid, num(p.amount), p.date || today()));
  });
});
/* admin-level day P&L (calendar import, separate from per-client daily_pnl) */
const replaceDayPnl = db.transaction(arr => {
  // ensure table exists (created lazily for older DBs)
  db.exec(`CREATE TABLE IF NOT EXISTS admin_day_pnl (id TEXT PRIMARY KEY, date TEXT, amount REAL, note TEXT)`);
  db.prepare('DELETE FROM admin_day_pnl').run();
  const ins = db.prepare('INSERT INTO admin_day_pnl(id,date,amount,note) VALUES(?,?,?,?)');
  (arr || []).forEach(r => ins.run(r.id || uid(), r.date || today(), num(r.amount), r.note || ''));
});

const replaceAffiliates = db.transaction(arr => {
  db.prepare('DELETE FROM affiliates').run();
  db.prepare('DELETE FROM affiliate_sales').run();
  const ia = db.prepare('INSERT INTO affiliates(id,name,email,code) VALUES(?,?,?,?)');
  const is = db.prepare('INSERT INTO affiliate_sales(id,affiliate_id,package,amount,date) VALUES(?,?,?,?,?)');
  (arr || []).forEach(a => {
    const aid = a.id || uid();
    ia.run(aid, a.name || '', a.email || '', a.code || '');
    (a.sales || []).forEach(s => is.run(s.id || uid(), aid, s.package || 'starter', num(s.amount), s.date || today()));
  });
});

const replaceClients = db.transaction(arr => {
  // Preserve stripe_session_id for any client that still exists (so webhook idempotency stays intact)
  const prevSessions = {};
  db.prepare('SELECT id, stripe_session_id FROM clients').all().forEach(r => { prevSessions[r.id] = r.stripe_session_id; });
  db.prepare('DELETE FROM clients').run();
  db.prepare('DELETE FROM daily_pnl').run();
  const ic = db.prepare(`INSERT INTO clients
    (id,name,email,package,status,split,access_code,stripe_session_id,joined)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const idp = db.prepare('INSERT INTO daily_pnl(id,client_id,date,amount,note) VALUES(?,?,?,?,?)');
  (arr || []).forEach(c => {
    const cid = c.id || uid();
    ic.run(cid, c.name || '', c.email || '', c.package || 'starter', c.status || 'pending',
      num(c.split), c.accessCode || null, c.stripeSessionId || prevSessions[cid] || null, c.joined || today());
    (c.dailyPnl || []).forEach(d => idp.run(d.id || uid(), cid, d.date || today(), num(d.amount), d.note || ''));
  });
});

/* ---------- Stripe checkout handling ---------- */
function handleCheckout({ sessionId, ref, email, name, packageKey }) {
  let c = null;
  if (ref) c = db.prepare('SELECT * FROM clients WHERE id=?').get(ref);
  if (!c && email) c = db.prepare('SELECT * FROM clients WHERE lower(email)=lower(?)').get(email);

  if (c) {
    const pkg = packageKey || c.package || 'starter';
    const code = c.access_code || genCode(c.name || name);
    db.prepare('UPDATE clients SET status=?, package=?, access_code=?, stripe_session_id=? WHERE id=?')
      .run('active', pkg, code, sessionId, c.id);
    return db.prepare('SELECT * FROM clients WHERE id=?').get(c.id);
  }
  // No matching pre-created client → create a new active client from the checkout details
  const id = uid();
  const code = genCode(name || email || 'client');
  db.prepare(`INSERT INTO clients
    (id,name,email,package,status,split,access_code,stripe_session_id,joined)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, name || (email || 'New Client'), email || '', packageKey || 'starter', 'active', 20, code, sessionId, today());
  return db.prepare('SELECT * FROM clients WHERE id=?').get(id);
}
function isProcessed(eventOrSessionId) {
  return !!db.prepare('SELECT id FROM processed_events WHERE id=?').get(eventOrSessionId);
}
function markProcessed(eventOrSessionId) {
  db.prepare('INSERT OR IGNORE INTO processed_events(id,created_at) VALUES(?,?)')
    .run(eventOrSessionId, new Date().toISOString());
}

/* ---------- auth lookups ---------- */
function findActiveClientByCode(code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM clients WHERE upper(access_code)=upper(?)').get(code) || null;
}
function getClientRow(id) {
  return db.prepare('SELECT * FROM clients WHERE id=?').get(id) || null;
}

/* ---------- daily report (scheduled 5 PM ET send) ---------- */
const REPORT_TZ = () => process.env.DAILY_SEND_TZ || 'America/New_York';
const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEK_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };

function isoAtNoon(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
function addDaysIso(iso, n) {
  const dt = isoAtNoon(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function weekdayIdx(iso) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TZ(), weekday: 'short' }).format(isoAtNoon(iso));
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0;
}
function mondayOfWeek(iso) {
  const idx = weekdayIdx(iso);
  return addDaysIso(iso, idx === 0 ? -6 : 1 - idx);
}
function formatReportDate(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TZ(), weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
  }).format(isoAtNoon(iso));
}
function dayMapFromRows(rows) {
  const m = {};
  rows.forEach(r => { m[r.date] = (m[r.date] || 0) + r.amount; });
  return m;
}
function buildWeekCalendar(dayMap, anchorIso) {
  const mon = mondayOfWeek(anchorIso);
  const days = WEEK_LABELS.map((wd, i) => {
    const date = addDaysIso(mon, i);
    const hasData = dayMap[date] != null;
    const amount = hasData ? dayMap[date] : null;
    return {
      date, weekday: wd, label: WEEK_FULL[wd], amount, hasData,
      isToday: date === anchorIso, isFuture: date > anchorIso
    };
  });
  const active = days.filter(d => d.hasData && !d.isFuture);
  const weekTotal = active.reduce((s, d) => s + d.amount, 0);
  const greenDays = active.filter(d => d.amount > 0).length;
  const redDays = active.filter(d => d.amount < 0).length;
  const tradingDays = active.length;
  return {
    days, weekTotal, greenDays, redDays, tradingDays,
    winRate: tradingDays ? Math.round(greenDays / tradingDays * 100) : 0
  };
}
function buildMonthStats(dayMap, anchorIso) {
  const ym = anchorIso.slice(0, 7);
  const entries = Object.entries(dayMap).filter(([d]) => d.slice(0, 7) === ym && d <= anchorIso);
  const tradingDays = entries.length;
  const greenDays = entries.filter(([, a]) => a > 0).length;
  const redDays = entries.filter(([, a]) => a < 0).length;
  const net = entries.reduce((s, [, a]) => s + a, 0);
  return { tradingDays, greenDays, redDays, net, winRate: tradingDays ? Math.round(greenDays / tradingDays * 100) : 0 };
}
function buildStreak(dayMap, anchorIso) {
  let streak = 0;
  let type = null;
  let d = anchorIso;
  while (dayMap[d] != null) {
    const sign = dayMap[d] > 0 ? 'win' : dayMap[d] < 0 ? 'loss' : 'flat';
    if (!type) type = sign;
    if (sign !== type || sign === 'flat') break;
    streak++;
    d = addDaysIso(d, -1);
    while (weekdayIdx(d) === 0 || weekdayIdx(d) === 6) d = addDaysIso(d, -1);
  }
  return { type, count: streak };
}

function etToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: REPORT_TZ() });
}
function latestEntryDate(id) {
  const r = db.prepare('SELECT date FROM daily_pnl WHERE client_id=? ORDER BY date DESC LIMIT 1').get(id);
  return r ? r.date : null;
}
function listActiveClients() {
  return db.prepare("SELECT * FROM clients WHERE status='active'").all();
}
// Build the figures for a client's daily email. date defaults to their latest uploaded day.
function buildDailyReport(id, isoDate) {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  if (!c) return null;
  const date = isoDate || latestEntryDate(id) || etToday();
  const dayRows = db.prepare('SELECT amount FROM daily_pnl WHERE client_id=? AND date=?').all(id, date);
  const todayPnl = dayRows.reduce((s, r) => s + r.amount, 0);
  const all = db.prepare('SELECT date, amount FROM daily_pnl WHERE client_id=?').all(id);
  const dayMap = dayMapFromRows(all);
  const total = all.reduce((s, r) => s + r.amount, 0);
  const ym = date.slice(0, 7);
  const mtd = all.filter(r => r.date.slice(0, 7) === ym).reduce((s, r) => s + r.amount, 0);
  const split = c.split || 0;
  const fee = total > 0 ? total * split / 100 : 0;
  const acctRow = db.prepare('SELECT COUNT(*) as n FROM accounts WHERE client_id=?').get(id);
  const week = buildWeekCalendar(dayMap, date);
  const month = buildMonthStats(dayMap, date);
  const streak = buildStreak(dayMap, date);
  return {
    clientId: c.id, name: c.name, email: c.email, accessCode: c.access_code, package: c.package || 'starter',
    date, dateLabel: formatReportDate(date), todayPnl, hasToday: dayRows.length > 0,
    mtd, total, split, fee, net: total - fee, accountCount: acctRow ? acctRow.n : 0,
    week, month, streak,
    appUrl: process.env.APP_URL || ''
  };
}
const dailyKey = (id, date) => 'daily:' + id + ':' + date;
function isDailySent(id, date) { return isProcessed(dailyKey(id, date)); }
function markDailySent(id, date) { markProcessed(dailyKey(id, date)); }

/* ---------- demo seed (optional) ---------- */
function seedDemo() {
  const play = (name, color, desc) => { const id = uid(); db.prepare('INSERT INTO plays(id,name,color,description) VALUES(?,?,?,?)').run(id, name, color, desc); return id; };
  const orb = play('Opening Range Breakout', '#22b8ef', 'Break & retest of the 15-min range on volume.');
  play('VWAP Reversion', '#3bd0c4', 'Fade extended moves back to VWAP in balance.');
  play('Failed Breakdown', '#34d399', 'Trap below prior-day low, reclaim and run.');
  const tp = play('Trend Pullback', '#f5b942', 'Buy first pullback to 9 EMA on a trend day.');

  const mkClient = (id, name, email, pkg, status, split, code) => {
    db.prepare(`INSERT INTO clients(id,name,email,package,status,split,access_code,joined) VALUES(?,?,?,?,?,?,?,?)`)
      .run(id, name, email, pkg, status, split, code, today());
    return id;
  };
  const cm = mkClient('seed-marcus', 'Marcus Bell', 'marcus.bell@email.com', 'pro', 'active', 20, 'MARC-7788');
  const cd = mkClient('seed-dana', 'Dana Cole', 'dana.cole@email.com', 'starter', 'active', 25, 'DANA-2255');
  mkClient('seed-priya', 'Priya Nair', 'priya.n@email.com', 'elite', 'pending', 15, 'PRIY-3030');

  const mkAcc = (id, clientId, firm, label, status, size, parentId) => {
    db.prepare('INSERT INTO accounts(id,client_id,firm,label,status,account_size,parent_account_id) VALUES(?,?,?,?,?,?,?)')
      .run(id, clientId, firm, label, status, size, parentId || null);
    return id;
  };
  const a1 = mkAcc('seed-a1', cm, 'Apex Trader Funding', 'Eval #1', 'evaluation', '50K', null);
  const a1f = mkAcc('seed-a1f', cm, 'Apex Trader Funding', 'Funded', 'funded', '50K', 'seed-a1');
  const a2 = mkAcc('seed-a2', cm, 'Topstep', '50K Combine', 'funded', '50K', null);
  const a3 = mkAcc('seed-a3', cd, 'Apex Trader Funding', 'Eval #2', 'evaluation', '50K', null);
  const a4 = mkAcc('seed-a4', cd, 'MyFundedFutures', '100K Expert', 'failed', '100K', null);

  const ex = (acc, type, amt, d) => db.prepare('INSERT INTO account_expenses(id,account_id,type,amount,date) VALUES(?,?,?,?,?)').run(uid(), acc, type, amt, d);
  const pa = (acc, amt, d) => db.prepare('INSERT INTO account_payouts(id,account_id,amount,date) VALUES(?,?,?,?)').run(uid(), acc, amt, d);
  ex(a1, 'Evaluation fee', 147, today()); pa(a1f, 2400, today()); pa(a1f, 1850, today());
  ex(a2, 'Evaluation fee', 165, today()); pa(a2, 3100, today());
  ex(a3, 'Evaluation fee', 147, today());
  ex(a4, 'Evaluation fee', 265, today());

  const dp = (cid, rows) => rows.forEach(([d, amt]) => db.prepare('INSERT INTO daily_pnl(id,client_id,date,amount,note) VALUES(?,?,?,?,?)').run(uid(), cid, isoBack(d), amt, ''));
  dp(cm, [[20, 640], [18, -310], [15, 880], [12, 1240], [11, -180], [8, 720], [5, 1310], [4, -260], [3, 540], [1, 470]]);
  dp(cd, [[19, 210], [16, -140], [14, 560], [10, 330], [7, -90], [5, 480], [3, 260], [1, 190]]);

  const mkTrade = (d, sym, playId, dir, en, exit, q, st, acc) => db.prepare(`INSERT INTO trades
    (id,account_id,play_id,symbol,date,direction,entry,exit,stop,contracts,emotion,plan,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid(), acc, playId, sym, isoBack(d), dir, en, exit, st, q, 'Disciplined', 1, '');
  mkTrade(15, 'ES', orb, 'Long', 5320.00, 5333.25, 2, 5314.00, a1);
  mkTrade(8, 'ES', orb, 'Long', 5375.25, 5388.50, 2, 5369.00, a2);
  mkTrade(5, 'MNQ', tp, 'Long', 18900, 18960, 3, 18874, a3);
}
function isoBack(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

module.exports = {
  db, initDb, uid, genCode,
  getSettings, patchSettings, setAdminPassword, setAdminCredentials, getAdminUsername, verifyAdmin,
  composeBootstrap, getClientPortal, composeClientApp, applyClientCsvUpload,
  saveClientTrades, saveClientAccounts, saveClientPlays, parseAcctSizeFromLabel,
  replacePlays, replaceTrades, replaceAccounts, replaceClients, replaceDayPnl, replaceAffiliates,
  handleCheckout, isProcessed, markProcessed,
  findActiveClientByCode, getClientRow,
  etToday, listActiveClients, buildDailyReport, isDailySent, markDailySent
};
