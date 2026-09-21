#!/usr/bin/env node
/**
 * Rebuild public/data/holdings.json from public/data/holdings.csv + options.csv.
 *
 * Usage (from repo root):
 *   node scripts/regen-holdings.mjs
 *
 * Optional overrides via env:
 *   AS_OF=2026-09-19 DAY=66 CASH_USD=32038 INVESTED_USD=93975 GOAL_USD=2000000
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

function num(v) {
  if (v == null || v === '') return NaN;
  return Number(String(v).replace(/,/g, ''));
}

const holdingsCsv = readFileSync(resolve(root, 'public/data/holdings.csv'), 'utf8');
const optionsCsv = readFileSync(resolve(root, 'public/data/options.csv'), 'utf8');

let existing = {};
try {
  existing = JSON.parse(readFileSync(resolve(root, 'public/data/holdings.json'), 'utf8'));
} catch {
  /* first run */
}

const priceColCandidates = ['实时价格', 'Price', 'price', 'Last', 'last'];

const holdings = parseCsv(holdingsCsv)
  .filter((r) => r.Ticker && r.Ticker.toUpperCase() !== 'CASH')
  .map((r) => {
    const shares = num(r.Shares);
    const cost = num(r.CostBasis);
    const rawW = r.Weight;
    const weight = rawW ? num(rawW) : undefined;
    let price;
    for (const col of priceColCandidates) {
      if (r[col] != null && r[col] !== '') {
        const p = num(r[col]);
        if (Number.isFinite(p)) {
          price = p;
          break;
        }
      }
    }
    const row = {
      ticker: r.Ticker.toUpperCase(),
      shares: Number.isInteger(shares) ? shares : shares,
      cost,
      costTotal: Math.round(cost * shares * 100) / 100,
    };
    if (weight != null && Number.isFinite(weight)) row.weight = weight;
    if (price != null && Number.isFinite(price)) {
      row.price = price;
      row.mv = Math.round(price * shares * 100) / 100;
    }
    return row;
  });

const options = parseCsv(optionsCsv)
  .filter((r) => r.Symbol)
  .map((r) => ({
    symbol: r.Symbol.toUpperCase(),
    type: r.Type,
    strike: Number(r.Strike),
    expiry: r.Expiry,
    premium: Number(r.Premium),
  }));

const prices = {};
for (const h of holdings) {
  if (h.price != null && Number.isFinite(h.price)) {
    prices[h.ticker] = h.price;
  }
}

const data = {
  as_of: process.env.AS_OF || existing.as_of || new Date().toISOString().slice(0, 10),
  day: Number(process.env.DAY || existing.day || 1),
  goal_usd: Number(process.env.GOAL_USD || existing.goal_usd || 2_000_000),
  cash_usd: Number(process.env.CASH_USD || existing.cash_usd || 0),
  invested_usd: Number(process.env.INVESTED_USD || existing.invested_usd || 0) || undefined,
  cum_pnl_usd: existing.cum_pnl_usd,
  total_assets_usd: existing.total_assets_usd,
  handle: existing.handle || 'CryptoTrix1',
  sub: existing.sub || 'US EQUITIES',
  start: existing.start || '2026-07-16',
  note: existing.note || '',
  holdings,
  options,
  prices,
};

if (data.invested_usd == null) delete data.invested_usd;
if (data.cum_pnl_usd == null) delete data.cum_pnl_usd;
if (data.total_assets_usd == null) delete data.total_assets_usd;

const out = resolve(root, 'public/data/holdings.json');
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(
  `Wrote ${out} (${holdings.length} holdings, ${options.length} options, as_of=${data.as_of}, day=${data.day}, prices=${Object.keys(prices).length})`
);
