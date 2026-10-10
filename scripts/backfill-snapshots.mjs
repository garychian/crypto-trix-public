#!/usr/bin/env node
/**
 * backfill-snapshots.mjs — ONE-TIME reconstruction of daily US portfolio snapshots from git history
 * of public/data/holdings.json. Needs git; no network. Safe to re-run (overwrites the same files).
 *
 * The `as_of` values in early holdings.json commits are not reliable market-close dates (publish-day
 * labels, broker re-anchors). The mapping below was verified against the fund-checkins.json chain
 * (total[d] = total[d-1] + pnl of the row covering d), e.g. 146,799 + 440 = 147,239 (9/22 close).
 *
 *   node scripts/backfill-snapshots.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/data/snapshots');
fs.mkdirSync(outDir, { recursive: true });

// market-close date → commit whose holdings.json holds that close
const MAP = {
  '2026-09-18': '36b5e01', // total 143,528   (= 9/21 broker anchor 146,799 − 3,271)
  '2026-09-21': 'd4755ab', // total 146,799   (broker re-anchor)
  '2026-09-22': '44534b0', // total 147,239
  '2026-09-23': 'c75592f', // total 146,523.22
  '2026-09-24': '15f3278', // total 146,690.19
  '2026-09-25': '9bfc3cf', // total 146,496.83
  '2026-09-28': '0ad143c', // total 144,123.75
  '2026-09-29': '5464c8a', // total 144,314.15 (after the 9/29 restructure)
  '2026-09-30': '06695a1', // total 144,755.62
  '2026-10-01': '3c31502', // total 144,713.93
  '2026-10-02': '02c59d1', // total 147,425.25
};

for (const [date, commit] of Object.entries(MAP)) {
  const raw = execFileSync('git', ['show', `${commit}:public/data/holdings.json`], { cwd: root, encoding: 'utf8' });
  const j = JSON.parse(raw);
  const holdings = j.holdings.map((h) => ({
    ticker: h.ticker,
    shares: Number(h.shares),
    price: h.price != null ? Number(h.price) : null,
    mv: h.mv != null ? Number(h.mv) : h.price != null ? Math.round(Number(h.price) * Number(h.shares) * 100) / 100 : null,
    cost_total: h.costTotal != null ? Number(h.costTotal) : null,
  }));
  const snap = {
    date,
    source: `git ${commit} public/data/holdings.json (backfilled)`,
    total_usd: Number(j.total_assets_usd),
    cash_usd: Number(j.cash_usd),
    holdings,
  };
  fs.writeFileSync(path.join(outDir, `${date}-us.json`), JSON.stringify(snap, null, 2) + '\n');
  console.log(date, commit, snap.total_usd);
}
