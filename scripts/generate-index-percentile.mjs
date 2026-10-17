/**
 * node scripts/generate-index-percentile.mjs
 * → public/data/index-percentile.json
 *
 * Static snapshot of S&P 500 / Nasdaq-100 price-range percentiles + SPY/QQQ
 * YTD max drawdown. Same math as /api/index-percentile (Yahoo daily closes).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/data/index-percentile.json');

const YAHOO_UA = 'Mozilla/5.0';
const PRIMARY = [
  { key: 'spx', symbol: '^GSPC', fallback: 'SPY', name: '标普500', name_en: 'S&P 500' },
  { key: 'ndx', symbol: '^NDX', fallback: 'QQQ', name: '纳斯达克100', name_en: 'Nasdaq-100' },
];
const MDD_ETFS = [
  { key: 'spy', symbol: 'SPY', name: 'SPY', name_zh: '标普500 ETF' },
  { key: 'qqq', symbol: 'QQQ', name: 'QQQ', name_zh: '纳斯达克100 ETF' },
];
const WINDOW_DEFS = [
  { key: '1y', label: '近一年', days: 365 },
  { key: 'ytd', label: '今年', days: null },
  { key: '2y', label: '两年', days: 730 },
  { key: '3y', label: '三年', days: 1095 },
];

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function yearStartISO(iso) {
  return `${iso.slice(0, 4)}-01-01`;
}

async function yahooDaily(sym) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?range=5y&interval=1d&includePrePost=false`;
  const r = await fetch(url, {
    headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`yahoo HTTP ${r.status} ${sym}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res?.timestamp?.length) throw new Error(`yahoo empty ${sym}`);
  const closes = res.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const c = closes[i];
    if (!Number.isFinite(c) || c <= 0) continue;
    rows.push({ date: new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10), close: c });
  }
  if (rows.length < 20) throw new Error(`yahoo short ${sym}`);
  const metaPrice = Number(res.meta?.regularMarketPrice);
  const price = Number.isFinite(metaPrice) && metaPrice > 0 ? metaPrice : rows[rows.length - 1].close;
  return {
    rows,
    price: round2(price),
    as_of: rows[rows.length - 1].date,
    symbol_used: res.meta?.symbol || sym,
  };
}

function windowStats(rows, price, asOf, def) {
  const from =
    def.key === 'ytd' ? yearStartISO(asOf) : addDaysISO(asOf, -(def.days || 365));
  const win = rows.filter((r) => r.date >= from);
  if (win.length < 2) return null;
  let lo = Infinity;
  let hi = -Infinity;
  let loDate = null;
  let hiDate = null;
  for (const r of win) {
    if (r.close < lo) {
      lo = r.close;
      loDate = r.date;
    }
    if (r.close > hi) {
      hi = r.close;
      hiDate = r.date;
    }
  }
  const span = hi - lo;
  const pct = span > 1e-9 ? ((price - lo) / span) * 100 : 50;
  return {
    pct: round1(Math.min(100, Math.max(0, pct))),
    high: round2(hi),
    low: round2(lo),
    high_date: hiDate,
    low_date: loDate,
    from: win[0].date,
    to: win[win.length - 1].date,
    n: win.length,
  };
}

/** YTD max drawdown: min(close / running_max - 1) from Jan 1. */
function ytdMdd(rows, asOf) {
  const from = yearStartISO(asOf);
  const win = rows.filter((r) => r.date >= from);
  if (win.length < 2) return null;
  let peak = win[0].close;
  let peakDate = win[0].date;
  let mdd = 0;
  let trough = win[0].close;
  let troughDate = win[0].date;
  let peakAtMdd = peak;
  let peakDateAtMdd = peakDate;
  for (const r of win) {
    if (r.close > peak) {
      peak = r.close;
      peakDate = r.date;
    }
    const dd = r.close / peak - 1;
    if (dd < mdd) {
      mdd = dd;
      trough = r.close;
      troughDate = r.date;
      peakAtMdd = peak;
      peakDateAtMdd = peakDate;
    }
  }
  return {
    mdd_pct: round2(mdd * 100),
    peak: round2(peakAtMdd),
    trough: round2(trough),
    peak_date: peakDateAtMdd,
    trough_date: troughDate,
    from: win[0].date,
    to: win[win.length - 1].date,
    n: win.length,
    price: round2(win[win.length - 1].close),
  };
}

async function loadIndex(cfg) {
  let used = cfg.symbol;
  let data;
  try {
    data = await yahooDaily(cfg.symbol);
  } catch (err) {
    if (!cfg.fallback) throw err;
    console.warn(`${cfg.symbol} failed (${err.message}); trying ${cfg.fallback}`);
    data = await yahooDaily(cfg.fallback);
    used = cfg.fallback;
  }
  const ranges = {};
  for (const def of WINDOW_DEFS) {
    const s = windowStats(data.rows, data.price, data.as_of, def);
    if (s) ranges[def.key] = s;
  }
  return {
    key: cfg.key,
    symbol: used,
    primary: cfg.symbol,
    proxy: used !== cfg.symbol ? used : null,
    name: cfg.name,
    name_en: cfg.name_en,
    price: data.price,
    as_of: data.as_of,
    ranges,
  };
}

async function loadMddEtf(cfg) {
  const data = await yahooDaily(cfg.symbol);
  const mdd = ytdMdd(data.rows, data.as_of);
  if (!mdd) throw new Error(`mdd empty ${cfg.symbol}`);
  return {
    key: cfg.key,
    symbol: cfg.symbol,
    name: cfg.name,
    name_zh: cfg.name_zh,
    as_of: data.as_of,
    ...mdd,
  };
}

const indices = {};
let asOf = null;
for (const cfg of PRIMARY) {
  const idx = await loadIndex(cfg);
  indices[cfg.key] = idx;
  if (!asOf || idx.as_of > asOf) asOf = idx.as_of;
  console.log(
    `${cfg.key} ${idx.symbol} @ ${idx.price} · 1y ${idx.ranges['1y']?.pct}% · ytd ${idx.ranges.ytd?.pct}%`
  );
}

const mdd_ytd = {};
for (const cfg of MDD_ETFS) {
  const row = await loadMddEtf(cfg);
  mdd_ytd[cfg.key] = row;
  if (!asOf || row.as_of > asOf) asOf = row.as_of;
  console.log(
    `mdd ${row.symbol} ${row.mdd_pct}%  peak ${row.peak}@${row.peak_date} → ${row.trough}@${row.trough_date}`
  );
}

const payload = {
  live: false,
  as_of: asOf,
  generated_at: new Date().toISOString(),
  source: 'Yahoo Finance daily closes · static snapshot (refresh: npm run index-pct)',
  windows: WINDOW_DEFS.map((w) => ({ key: w.key, label: w.label })),
  indices,
  mdd_ytd,
};

await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log('wrote', path.relative(ROOT, OUT));
