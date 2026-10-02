'use strict';
const { db, uid } = require('./db');

const CONTRACTS = {
  ES: { tickSize: 0.25, tickValue: 12.5 }, MES: { tickSize: 0.25, tickValue: 1.25 },
  NQ: { tickSize: 0.25, tickValue: 5 }, MNQ: { tickSize: 0.25, tickValue: 0.5 },
  YM: { tickSize: 1, tickValue: 5 }, MYM: { tickSize: 1, tickValue: 0.5 },
  RTY: { tickSize: 0.1, tickValue: 5 }, M2K: { tickSize: 0.1, tickValue: 0.5 },
  CL: { tickSize: 0.01, tickValue: 10 }, MCL: { tickSize: 0.01, tickValue: 1 },
  GC: { tickSize: 0.1, tickValue: 10 }, MGC: { tickSize: 0.1, tickValue: 1 }
};

function tradePnl(t) {
  if (t.csvPnl != null && t.csvPnl !== '' && !isNaN(+t.csvPnl)) return +t.csvPnl;
  if (t.pnl != null && t.pnl !== '' && !isNaN(+t.pnl)) return +t.pnl;
  const c = CONTRACTS[String(t.symbol || '').toUpperCase()] || { tickSize: 0.25, tickValue: 12.5 };
  const dir = t.direction === 'Short' ? -1 : 1;
  const points = ((+t.exit || 0) - (+t.entry || 0)) * dir;
  return points * (c.tickValue / c.tickSize) * ((+t.contracts) || 1);
}

function defaults() {
  return {
    profitTarget: 100000,
    dailyLossLimit: 750,
    weeklyLossLimit: 1800,
    maxDrawdownLimit: 2500,
    softWarningPct: 80,
    growthStyle: 'Balanced',
    purpose: 'Growth Account',
    contribAmount: 0,
    contribDay: 14,
    contribStart: '',
    contribOn: 0,
    withdrawAmount: 0,
    withdrawDay: 15,
    withdrawStart: '',
    withdrawOn: 0
  };
}

function ensureTables() {
  db.exec(`CREATE TABLE IF NOT EXISTS live_capital_settings (
    owner_id TEXT PRIMARY KEY,
    profit_target REAL, daily_loss REAL, weekly_loss REAL, max_dd REAL, soft_pct REAL,
    growth_style TEXT, purpose TEXT,
    contrib_amount REAL, contrib_day INTEGER, contrib_start TEXT, contrib_on INTEGER,
    withdraw_amount REAL, withdraw_day INTEGER, withdraw_start TEXT, withdraw_on INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS live_capital_txns (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL,
    amount REAL NOT NULL, note TEXT, status TEXT, source TEXT, created_at TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_lc_tx_owner ON live_capital_txns(owner_id, date)');
}

function rowSettings(r) {
  const d = defaults();
  if (!r) return d;
  return {
    profitTarget: r.profit_target != null ? r.profit_target : d.profitTarget,
    dailyLossLimit: r.daily_loss != null ? r.daily_loss : d.dailyLossLimit,
    weeklyLossLimit: r.weekly_loss != null ? r.weekly_loss : d.weeklyLossLimit,
    maxDrawdownLimit: r.max_dd != null ? r.max_dd : d.maxDrawdownLimit,
    softWarningPct: r.soft_pct != null ? r.soft_pct : d.softWarningPct,
    growthStyle: r.growth_style || d.growthStyle,
    purpose: r.purpose || d.purpose,
    contribAmount: r.contrib_amount || 0,
    contribDay: r.contrib_day || 14,
    contribStart: r.contrib_start || '',
    contribOn: r.contrib_on ? 1 : 0,
    withdrawAmount: r.withdraw_amount || 0,
    withdrawDay: r.withdraw_day || 15,
    withdrawStart: r.withdraw_start || '',
    withdrawOn: r.withdraw_on ? 1 : 0
  };
}

function loadSettings(ownerId) {
  ensureTables();
  return rowSettings(db.prepare('SELECT * FROM live_capital_settings WHERE owner_id=?').get(ownerId));
}

function saveSettings(ownerId, body) {
  ensureTables();
  const cur = loadSettings(ownerId);
  const s = Object.assign({}, cur, body || {});
  db.prepare(`INSERT INTO live_capital_settings(owner_id,profit_target,daily_loss,weekly_loss,max_dd,soft_pct,growth_style,purpose,
    contrib_amount,contrib_day,contrib_start,contrib_on,withdraw_amount,withdraw_day,withdraw_start,withdraw_on)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner_id) DO UPDATE SET
      profit_target=excluded.profit_target, daily_loss=excluded.daily_loss, weekly_loss=excluded.weekly_loss,
      max_dd=excluded.max_dd, soft_pct=excluded.soft_pct, growth_style=excluded.growth_style, purpose=excluded.purpose,
      contrib_amount=excluded.contrib_amount, contrib_day=excluded.contrib_day, contrib_start=excluded.contrib_start, contrib_on=excluded.contrib_on,
      withdraw_amount=excluded.withdraw_amount, withdraw_day=excluded.withdraw_day, withdraw_start=excluded.withdraw_start, withdraw_on=excluded.withdraw_on
  `).run(
    ownerId, +s.profitTarget || 0, +s.dailyLossLimit || 0, +s.weeklyLossLimit || 0, +s.maxDrawdownLimit || 0, +s.softWarningPct || 0,
    s.growthStyle || 'Balanced', s.purpose || 'Growth Account',
    +s.contribAmount || 0, Math.min(28, Math.max(1, parseInt(s.contribDay, 10) || 14)), s.contribStart || '', s.contribOn ? 1 : 0,
    +s.withdrawAmount || 0, Math.min(28, Math.max(1, parseInt(s.withdrawDay, 10) || 15)), s.withdrawStart || '', s.withdrawOn ? 1 : 0
  );
  syncSchedules(ownerId);
  return getView(ownerId);
}

function listTxns(ownerId) {
  ensureTables();
  return db.prepare('SELECT * FROM live_capital_txns WHERE owner_id=? ORDER BY date DESC, created_at DESC').all(ownerId).map(t => ({
    id: t.id, date: t.date, type: t.type, amount: t.amount, note: t.note || '', status: t.status || 'posted', source: t.source || 'manual'
  }));
}

function addTxn(ownerId, body) {
  ensureTables();
  const type = String(body.type || 'deposit').toLowerCase();
  if (!['deposit', 'withdrawal', 'fee', 'correction'].includes(type)) throw new Error('Unknown transaction type');
  const id = uid();
  db.prepare(`INSERT INTO live_capital_txns(id,owner_id,date,type,amount,note,status,source,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    id, ownerId, String(body.date || '').slice(0, 10), type, type === 'correction' ? (+body.amount || 0) : Math.abs(+body.amount || 0),
    body.note || '', body.status === 'pending' ? 'pending' : 'posted', 'manual', new Date().toISOString()
  );
  return getView(ownerId);
}

function patchTxn(ownerId, id, body) {
  const row = db.prepare('SELECT * FROM live_capital_txns WHERE owner_id=? AND id=?').get(ownerId, id);
  if (!row) throw new Error('Transaction not found');
  const status = body.status || row.status;
  if (!['posted', 'pending', 'cancelled'].includes(status)) throw new Error('Bad status');
  db.prepare('UPDATE live_capital_txns SET status=?, note=? WHERE id=?').run(status, body.note != null ? body.note : row.note, id);
  return getView(ownerId);
}

function deleteTxn(ownerId, id) {
  db.prepare('DELETE FROM live_capital_txns WHERE owner_id=? AND id=?').run(ownerId, id);
  return getView(ownerId);
}

function monthKey(iso) { return String(iso || '').slice(0, 7); }
function isoDate(y, m, day) {
  const dim = new Date(y, m, 0).getDate();
  const d = Math.min(day, dim);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function syncSchedules(ownerId) {
  const s = loadSettings(ownerId);
  const plans = [];
  if (s.contribOn && s.contribAmount > 0 && s.contribStart) plans.push({ type: 'deposit', amount: s.contribAmount, day: s.contribDay, start: s.contribStart, note: 'Scheduled contribution managed by Capital Rules' });
  if (s.withdrawOn && s.withdrawAmount > 0 && s.withdrawStart) plans.push({ type: 'withdrawal', amount: s.withdrawAmount, day: s.withdrawDay, start: s.withdrawStart, note: 'Scheduled withdrawal managed by Capital Rules' });
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + 2);
  const end = horizon.toISOString().slice(0, 10);
  plans.forEach(p => {
    let y = +p.start.slice(0, 4), m = +p.start.slice(5, 7);
    for (let i = 0; i < 36; i++) {
      const date = isoDate(y, m, p.day);
      if (date < p.start.slice(0, 10)) { m += 1; if (m > 12) { m = 1; y += 1; } continue; }
      if (date > end) break;
      const exists = db.prepare('SELECT id FROM live_capital_txns WHERE owner_id=? AND date=? AND type=? AND source=?').get(ownerId, date, p.type, 'schedule');
      if (!exists) {
        const status = date > today ? 'pending' : 'posted';
        db.prepare(`INSERT INTO live_capital_txns(id,owner_id,date,type,amount,note,status,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(uid(), ownerId, date, p.type, p.amount, p.note, status, 'schedule', new Date().toISOString());
      }
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
  });
}

function ownerTrades(ownerId) {
  if (ownerId === 'admin') {
    return db.prepare('SELECT * FROM trades').all();
  }
  return db.prepare('SELECT * FROM client_trades WHERE client_id=?').all(ownerId).map(t => ({ ...t, csvPnl: t.pnl }));
}

function weekKey(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const one = new Date(d);
  const day = (one.getUTCDay() + 6) % 7;
  one.setUTCDate(one.getUTCDate() - day);
  return one.toISOString().slice(0, 10);
}

function buildSnapshot({ settings, txns, trades, today }) {
  const s = Object.assign(defaults(), settings || {});
  const todayIso = today || new Date().toISOString().slice(0, 10);
  const posted = (txns || []).filter(t => (t.status || 'posted') === 'posted');
  const byDay = {};
  function bump(date, key, amt) {
    if (!date) return;
    byDay[date] = byDay[date] || { trade: 0, deposit: 0, withdrawal: 0, fee: 0, correction: 0 };
    byDay[date][key] += amt;
  }
  posted.forEach(t => {
    const amt = Math.abs(+t.amount || 0);
    if (t.type === 'deposit') bump(t.date, 'deposit', amt);
    else if (t.type === 'withdrawal') bump(t.date, 'withdrawal', amt);
    else if (t.type === 'fee') bump(t.date, 'fee', amt);
    else if (t.type === 'correction') bump(t.date, 'correction', +t.amount || 0);
  });
  const linked = [];
  (trades || []).forEach(t => {
    const pnl = tradePnl(t);
    if (!t.date || isNaN(pnl)) return;
    bump(String(t.date).slice(0, 10), 'trade', pnl);
    linked.push({ symbol: t.symbol || '', pnl, date: t.date });
  });
  const dates = Object.keys(byDay).sort();
  let equity = 0, peak = 0, maxDd = 0, tradeSum = 0, dep = 0, wd = 0, fees = 0;
  const curve = [];
  const months = {};
  dates.forEach(date => {
    const b = byDay[date];
    const ext = b.deposit - b.withdrawal - b.fee + b.correction;
    equity += ext + b.trade;
    tradeSum += b.trade; dep += b.deposit; wd += b.withdrawal; fees += b.fee;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    curve.push({ date, equity, organic: tradeSum, baseline: dep > 0 ? (curve[0] ? null : null) : 0 });
    const mk = monthKey(date);
    months[mk] = months[mk] || { trade: 0, deposit: 0, withdrawal: 0, fee: 0, end: 0 };
    months[mk].trade += b.trade;
    months[mk].deposit += b.deposit;
    months[mk].withdrawal += b.withdrawal + b.fee;
    months[mk].end = equity;
  });
  const startDep = posted.filter(t => t.type === 'deposit').sort((a, b) => a.date.localeCompare(b.date))[0];
  const baseline = startDep ? Math.abs(+startDep.amount) : 0;
  const netChange = equity - (baseline && dates.length ? 0 : 0);
  const netExternal = dep - wd - fees;
  const organic = tradeSum;
  const current = equity;
  const netAccountChange = current - baseline;
  const currentDd = Math.max(0, peak - current);
  const dayTrade = (byDay[todayIso] && byDay[todayIso].trade) || 0;
  const dayLoss = dayTrade < 0 ? -dayTrade : 0;
  let weekLoss = 0;
  const wk = weekKey(todayIso);
  Object.keys(byDay).forEach(d => {
    if (weekKey(d) === wk && byDay[d].trade < 0) weekLoss += -byDay[d].trade;
  });
  const wins = linked.filter(t => t.pnl > 0);
  const losses = linked.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const best = linked.slice().sort((a, b) => b.pnl - a.pnl)[0] || null;
  const monthRows = Object.keys(months).sort().map(k => {
    const m = months[k];
    const net = m.trade + m.deposit - m.withdrawal;
    return { month: k, trade: m.trade, contributions: m.deposit, withdrawals: m.withdrawal, net, ending: m.end };
  });
  const paceMonths = monthRows.filter(m => m.trade !== 0);
  const monthlyPace = paceMonths.length ? paceMonths.reduce((a, m) => a + m.trade, 0) / paceMonths.length : 0;
  const gap = Math.max(0, s.profitTarget - current);
  const estMonths = monthlyPace > 0 ? Math.ceil(gap / monthlyPace) : null;
  const soft = (s.softWarningPct || 80) / 100;
  const warnings = [];
  if (s.dailyLossLimit && dayLoss >= s.dailyLossLimit * soft) warnings.push('Daily loss is near the daily limit.');
  if (s.weeklyLossLimit && weekLoss >= s.weeklyLossLimit * soft) warnings.push('Weekly loss is near the weekly limit.');
  if (s.maxDrawdownLimit && currentDd >= s.maxDrawdownLimit * soft) warnings.push('Drawdown is near the max drawdown limit.');
  const buffer = Math.max(0, (s.maxDrawdownLimit || 0) - currentDd);
  return {
    settings: s,
    current, baseline, netAccountChange, organic, netExternal, fees,
    netContributions: dep - wd,
    realized: organic,
    currentDrawdown: currentDd,
    currentDrawdownPct: peak > 0 ? (currentDd / peak) * 100 : 0,
    maxDrawdown: maxDd,
    dayLossPct: s.dailyLossLimit ? (dayLoss / s.dailyLossLimit) * 100 : 0,
    weekLossPct: s.weeklyLossLimit ? (weekLoss / s.weeklyLossLimit) * 100 : 0,
    recoveryPct: peak > 0 && current < peak ? ((peak - current) / current) * 100 : 0,
    buffer,
    target: s.profitTarget,
    targetPct: s.profitTarget ? Math.min(100, (current / s.profitTarget) * 100) : 0,
    remaining: Math.max(0, s.profitTarget - current),
    monthlyPace, estMonths,
    curve: curve.map((p, i) => ({ date: p.date, equity: p.equity, organic: p.organic, baseline: i === 0 ? baseline : baseline })),
    months: monthRows,
    warnings,
    linkedCount: linked.length,
    winRate: linked.length ? (wins.length / linked.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    best,
    txns: txns || []
  };
}

function getView(ownerId) {
  ensureTables();
  syncSchedules(ownerId);
  const settings = loadSettings(ownerId);
  const txns = listTxns(ownerId);
  const trades = ownerTrades(ownerId);
  return buildSnapshot({ settings, txns, trades });
}

module.exports = {
  ensureTables, tradePnl, buildSnapshot, getView, saveSettings, addTxn, patchTxn, deleteTxn, defaults
};
