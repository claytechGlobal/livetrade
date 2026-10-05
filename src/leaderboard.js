'use strict';
const { db } = require('./db');
const { tradePnl } = require('./liveCapital');

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function stats(trades, from, to) {
  const rows = (trades || []).filter(t => {
    const d = String(t.date || '').slice(0, 10);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  let profit = 0, wins = 0, winSum = 0;
  rows.forEach(t => {
    const p = tradePnl(t);
    if (isNaN(p)) return;
    profit += p;
    if (p > 0) { wins += 1; winSum += p; }
  });
  const n = rows.length;
  return {
    profit,
    trades: n,
    winRate: n ? (wins / n) * 100 : 0,
    avgGain: wins ? winSum / wins : 0
  };
}

function marks(trades, today) {
  const monthStart = today.slice(0, 7) + '-01';
  const m1 = stats(trades, monthStart, today).profit > 0;
  const m3 = stats(trades, addDays(today, -90), today).profit > 0;
  const y1 = stats(trades, addDays(today, -365), today).profit > 0;
  return { month: m1, quarter: m3, year: y1, count: [m1, m3, y1].filter(Boolean).length };
}

function rankBoard(people, { sort, range, today }) {
  const day = today || new Date().toISOString().slice(0, 10);
  let from = null;
  if (range === '30d') from = addDays(day, -30);
  else if (range === '90d') from = addDays(day, -90);
  else if (range === 'year') from = day.slice(0, 4) + '-01-01';
  const key = ['profit', 'winRate', 'avgGain', 'trades'].includes(sort) ? sort : 'profit';
  const rows = (people || []).map(p => {
    const s = stats(p.trades, from, day);
    return { id: p.id, name: p.name, ...s, marks: marks(p.trades, day) };
  }).filter(r => r.trades > 0);
  rows.sort((a, b) => (b[key] - a[key]) || (b.profit - a.profit) || a.name.localeCompare(b.name));
  return { sort: key, range: range || 'all', today: day, rows: rows.map((r, i) => ({ rank: i + 1, ...r })) };
}

function getLeaderboard(query) {
  const trader = db.prepare("SELECT value FROM settings WHERE key='trader'").get();
  const people = [{
    id: 'admin',
    name: (trader && trader.value) || 'Trader',
    trades: db.prepare('SELECT date, symbol, direction, entry, exit, contracts FROM trades').all()
  }];
  const clients = db.prepare("SELECT id, name FROM clients WHERE status='active'").all();
  clients.forEach(c => {
    people.push({
      id: c.id,
      name: c.name || 'Client',
      trades: db.prepare('SELECT date, symbol, direction, entry, exit, contracts, pnl FROM client_trades WHERE client_id=?').all(c.id)
        .map(t => ({ ...t, csvPnl: t.pnl }))
    });
  });
  return rankBoard(people, { sort: query && query.sort, range: query && query.range });
}

module.exports = { rankBoard, getLeaderboard, stats };
