'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rankBoard } = require('../src/leaderboard');

test('ranks by profit and counts dollar marks from real trades', () => {
  const board = rankBoard([
    { id: 'a', name: 'Ada', trades: [
      { date: '2026-10-01', csvPnl: 400 },
      { date: '2026-09-02', csvPnl: 100 },
      { date: '2025-12-01', csvPnl: 50 }
    ]},
    { id: 'b', name: 'Ben', trades: [
      { date: '2026-10-02', csvPnl: -20 },
      { date: '2026-10-03', csvPnl: 80 }
    ]}
  ], { sort: 'profit', range: 'all', today: '2026-10-05' });
  assert.equal(board.rows[0].name, 'Ada');
  assert.equal(board.rows[0].profit, 550);
  assert.equal(board.rows[0].trades, 3);
  assert.equal(board.rows[0].marks.count, 3);
  assert.equal(board.rows[1].winRate, 50);
  assert.equal(board.rows[1].avgGain, 80);
});

test('30 day window drops older trades', () => {
  const board = rankBoard([
    { id: 'a', name: 'Ada', trades: [{ date: '2026-01-01', csvPnl: 9000 }, { date: '2026-10-01', csvPnl: 10 }] }
  ], { sort: 'profit', range: '30d', today: '2026-10-05' });
  assert.equal(board.rows[0].profit, 10);
  assert.equal(board.rows[0].trades, 1);
});
