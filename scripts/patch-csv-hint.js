'use strict';
const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
let h = fs.readFileSync(htmlPath, 'utf8');

const old = 'Needs a header + rows with PnL and a real date (EnteredAt / ExitedAt / TradeDay as YYYY-MM-DD). Weekday-only TradeDay is fine if EnteredAt has the date. Updates dashboard, calendar, and trade log.';
const neu = 'Supports trade CSVs (date + PnL) and broker balance CSVs (BeginningBalance / PL / EndingBalance). Balance files update that day P&L only — existing trades stay. Trade uploads append; nothing is wiped.';
if (!h.includes(old)) {
  console.error('hint not found');
  process.exit(1);
}
h = h.replace(old, neu);

const oldFlash = "flash('CSV applied — '+(res.trades||0)+' trades · '+(res.days||0)+' days');";
const newFlash = "flash(res.mode==='balance'?('Balance P&L saved — $'+(Number(res.totalPnl)||0)+' on '+(res.dates||[]).join(', ')):'CSV applied — '+(res.trades||0)+' trades · '+(res.days||0)+' days');";
if (!h.includes(oldFlash)) {
  console.error('flash not found');
  process.exit(1);
}
h = h.replace(oldFlash, newFlash);
fs.writeFileSync(htmlPath, h);
console.log('ui hint/flash updated');
