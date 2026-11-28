import test from 'node:test';
import assert from 'node:assert/strict';
import { settledDailyPnl } from '../src/lib/capital.js';

const snapshot = {
  as_of: '2026-11-20',
  daily_pnl: { close_date: '2026-11-20', pnl_usd: -7515.32 },
};

test('settled account loss includes trades at the anchor close and over the weekend', () => {
  for (const date of ['2026-11-20T22:00:00Z', '2026-11-21T12:00:00Z', '2026-11-22T12:00:00Z']) {
    assert.equal(settledDailyPnl(snapshot, 'live', new Date(date)), -7515.32);
  }
});

test('a new live weekday resumes quote P&L, snapshot fallback keeps its dated settlement', () => {
  const nextSession = new Date('2026-11-23T16:00:00Z');
  assert.equal(settledDailyPnl(snapshot, 'live', nextSession), null);
  assert.equal(settledDailyPnl(snapshot, 'snapshot', nextSession), -7515.32);
});

test('missing, invalid, and stale settlement metadata never overrides quotes', () => {
  assert.equal(settledDailyPnl(null, 'snapshot'), null);
  assert.equal(settledDailyPnl({ as_of: snapshot.as_of }, 'snapshot'), null);
  assert.equal(settledDailyPnl({ ...snapshot, as_of: '2026-11-23' }, 'snapshot'), null);
  assert.equal(settledDailyPnl({ ...snapshot, daily_pnl: { ...snapshot.daily_pnl, pnl_usd: NaN } }, 'snapshot'), null);
});
