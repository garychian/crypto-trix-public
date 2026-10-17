/**
 * Vercel serverless: GET /api/index-percentile
 *
 * S&P 500 (^GSPC) + Nasdaq-100 (^NDX, QQQ fallback) historical price
 * percentile over selectable windows of daily closes:
 *   1y / ytd / 2y / 3y
 *   percentile = (price - low) / (high - low)   // current vs window range
 *
 * Free source: Yahoo Finance chart API (same UA pattern as /api/prices).
 * Frontend falls back to /data/index-percentile.json if this fails.
 *
 * ESM export — package.json has "type": "module".
 */

const YAHOO_UA = 'Mozilla/5.0';
const PRIMARY = [
  { key: 'spx', symbol: '^GSPC', fallback: 'SPY', name: '标普500', name_en: 'S&P 500' },
  { key: 'ndx', symbol: '^NDX', fallback: 'QQQ', name: '纳斯达克100', name_en: 'Nasdaq-100' },
];

const WINDOW_DEFS = [
  // 1y: 365 calendar days ≈ ~252 US trading sessions back from as_of
  { key: '1y', label: '近一年', days: 365 },
  // ytd: calendar year start (Jan 1 of as_of year); first session may be Jan 2
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
    // Daily bars are stamped at session open (ET); UTC date == trading date.
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

async function loadIndex(cfg) {
  let used = cfg.symbol;
  let data;
  try {
    data = await yahooDaily(cfg.symbol);
  } catch (err) {
    if (!cfg.fallback) throw err;
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const results = await Promise.allSettled(PRIMARY.map(loadIndex));
    const out = {
      live: true,
      as_of: null,
      source: 'Yahoo Finance daily closes · ^GSPC / ^NDX',
      windows: WINDOW_DEFS.map((w) => ({ key: w.key, label: w.label })),
      indices: {},
    };
    let ok = 0;
    results.forEach((r, i) => {
      const cfg = PRIMARY[i];
      if (r.status !== 'fulfilled') return;
      out.indices[cfg.key] = r.value;
      if (!out.as_of || r.value.as_of > out.as_of) out.as_of = r.value.as_of;
      ok++;
    });
    if (ok === 0) {
      res.status(502).json({ error: 'index-percentile upstream failed' });
      return;
    }
    const proxies = Object.values(out.indices)
      .filter((x) => x.proxy)
      .map((x) => `${x.primary}→${x.proxy}`);
    if (proxies.length) {
      out.source += ` · proxy ${proxies.join(', ')}`;
    }
    res.status(200).json(out);
  } catch (err) {
    res.status(502).json({
      error: 'index-percentile upstream failed',
      detail: String(err && err.message),
    });
  }
}
