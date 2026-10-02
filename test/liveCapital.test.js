'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot, tradePnl } = require('../src/liveCapital');

test('trade pnl uses csv when present', () => {
  assert.equal(tradePnl({ csvPnl: 125.5, entry: 1, exit: 2 }), 125.5);
});

test('deposits are not trading profit and drawdown uses peak', () => {
  const snap = buildSnapshot({
    settings: { profitTarget: 100000, dailyLossLimit: 500, weeklyLossLimit: 1000, maxDrawdownLimit: 2500, softWarningPct: 80 },
    today: '2026-03-02',
    txns: [
      { date: '2026-01-01', type: 'deposit', amount: 25000, status: 'posted' },
      { date: '2026-02-01', type: 'withdrawal', amount: 100, status: 'posted' },
      { date: '2026-03-01', type: 'deposit', amount: 300, status: 'pending' }
    ],
    trades: [
      { date: '2026-01-10', csvPnl: 800, symbol: 'ES' },
      { date: '2026-02-10', csvPnl: -200, symbol: 'NQ' },
      { date: '2026-03-02', csvPnl: 100, symbol: 'ES' }
    ]
  });
  assert.equal(snap.baseline, 25000);
  assert.equal(snap.realized, 700);
  assert.equal(snap.current, 25000 - 100 + 700);
  assert.equal(snap.netAccountChange, snap.current - 25000);
  assert.equal(snap.currentDrawdown, 200);
  assert.ok(snap.maxDrawdown >= 200);
  assert.equal(snap.linkedCount, 3);
  assert.equal(snap.months.length, 3);
  assert.ok(snap.targetPct > 0 && snap.targetPct < 100);
});

test('pending deposits do not change equity', () => {
  const snap = buildSnapshot({
    txns: [{ date: '2026-05-01', type: 'deposit', amount: 5000, status: 'pending' }],
    trades: [],
    today: '2026-04-01'
  });
  assert.equal(snap.current, 0);
  assert.equal(snap.txns.length, 1);
});

test('soft warning when daily loss is close to the limit', () => {
  const snap = buildSnapshot({
    settings: { dailyLossLimit: 100, weeklyLossLimit: 1000, maxDrawdownLimit: 5000, softWarningPct: 80, profitTarget: 10000 },
    today: '2026-06-02',
    txns: [{ date: '2026-06-01', type: 'deposit', amount: 1000, status: 'posted' }],
    trades: [{ date: '2026-06-02', csvPnl: -90, symbol: 'MES' }]
  });
  assert.ok(snap.warnings.some(w => /Daily loss/.test(w)));
  assert.ok(snap.buffer < 5000);
});
