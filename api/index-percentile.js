/**
 * Vercel serverless: GET /api/index-percentile
 *
 * S&P 500 (^GSPC) + Nasdaq-100 (^NDX, QQQ fallback) historical price
 * percentile over selectable windows of daily closes:
 *   1y / ytd / 2y / 3y
 *   percentile = (price - low) / (high - low)   // current vs window range
 *
 * Also calendar-year max drawdown for cash indices (^GSPC / ^NDX):
 *   for each day in year Y: dd = close/running_max − 1; mdd = min(dd)
 *   running_max resets at the start of each calendar year.
 *   Current year = YTD (Jan 1 → latest close).
 *   ^NDX history starts ~1985-10 — no invented pre-launch years.
 *
 * Free source: Yahoo Finance chart API (period1/period2 daily; range=max
 * downsamples). Frontend falls back to /data/index-percentile.json.
 *
 * ESM export — package.json has "type": "module".
 */

const YAHOO_UA = 'Mozilla/5.0';
const PRIMARY = [
  { key: 'spx', symbol: '^GSPC', fallback: 'SPY', name: '标普500', name_en: 'S&P 500', name_zh: '标普500' },
  { key: 'ndx', symbol: '^NDX', fallback: 'QQQ', name: '纳斯达克100', name_en: 'Nasdaq-100', name_zh: '纳斯达克100' },
];

const WINDOW_DEFS = [
  // 1y: 365 calendar days ≈ ~252 US trading sessions back from as_of
  { key: '1y', label: '近一年', days: 365 },
  // ytd: calendar year start (Jan 1 of as_of year); first session may be Jan 2
  { key: 'ytd', label: '今年', days: null },
  { key: '2y', label: '两年', days: 730 },
  { key: '3y', label: '三年', days: 1095 },
];

/** ~50y lookback for annual MDD; period1/period2 keeps daily bars (range=max does not). */
const HISTORY_START_ISO = '1975-01-01';

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

async function yahooDaily(sym, { fromISO = null } = {}) {
  let url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?interval=1d&includePrePost=false`;
  if (fromISO) {
    const period1 = Math.floor(new Date(`${fromISO}T00:00:00Z`).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    url += `&period1=${period1}&period2=${period2}`;
  } else {
    url += `&range=5y`;
  }
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
    history_from: rows[0].date,
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

/**
 * Max drawdown on daily closes within [from, to] inclusive.
 * running_max starts at the first close in the window (calendar-year MDD).
 */
function windowMdd(rows, from, to) {
  const win = rows.filter((r) => r.date >= from && r.date <= to);
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
    mdd_pct: round2(mdd * 100), // negative or zero
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

function ytdMdd(rows, asOf) {
  return windowMdd(rows, yearStartISO(asOf), asOf);
}

/** Per calendar year MDD; newest year first. Current year flagged ytd:true. */
function annualMddSeries(rows, asOf) {
  if (!rows.length) return { history_from: null, years: [] };
  const historyFrom = rows[0].date;
  const firstYear = Number(historyFrom.slice(0, 4));
  const lastYear = Number(asOf.slice(0, 4));
  const years = [];
  for (let y = lastYear; y >= firstYear; y--) {
    const from = `${y}-01-01`;
    const to = y === lastYear ? asOf : `${y}-12-31`;
    const mdd = windowMdd(rows, from, to);
    if (!mdd) continue;
    // Skip a partial first year with too few sessions (e.g. NDX late-1985)
    if (y === firstYear && mdd.n < 20) continue;
    years.push({
      year: y,
      ytd: y === lastYear,
      ...mdd,
    });
  }
  return { history_from: historyFrom, years };
}

async function loadIndexBundle(cfg) {
  let used = cfg.symbol;
  let data;
  try {
    data = await yahooDaily(cfg.symbol, { fromISO: HISTORY_START_ISO });
  } catch (err) {
    if (!cfg.fallback) throw err;
    data = await yahooDaily(cfg.fallback, { fromISO: HISTORY_START_ISO });
    used = cfg.fallback;
  }
  const ranges = {};
  for (const def of WINDOW_DEFS) {
    const s = windowStats(data.rows, data.price, data.as_of, def);
    if (s) ranges[def.key] = s;
  }
  const mdd = ytdMdd(data.rows, data.as_of);
  const annual = annualMddSeries(data.rows, data.as_of);
  // Only attach cash-index MDD when we actually used the primary index symbol
  // (not an ETF proxy fallback).
  const isCashIndex = used === cfg.symbol;
  return {
    index: {
      key: cfg.key,
      symbol: used,
      primary: cfg.symbol,
      proxy: used !== cfg.symbol ? used : null,
      name: cfg.name,
      name_en: cfg.name_en,
      price: data.price,
      as_of: data.as_of,
      ranges,
    },
    mdd_ytd: isCashIndex && mdd
      ? {
          key: cfg.key,
          symbol: cfg.symbol,
          name: cfg.name,
          name_en: cfg.name_en,
          name_zh: cfg.name_zh,
          as_of: data.as_of,
          history_from: annual.history_from,
          ...mdd,
        }
      : null,
    mdd_annual: isCashIndex
      ? {
          key: cfg.key,
          symbol: cfg.symbol,
          name: cfg.name,
          name_en: cfg.name_en,
          name_zh: cfg.name_zh,
          history_from: annual.history_from,
          years: annual.years,
        }
      : null,
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
    const results = await Promise.allSettled(PRIMARY.map(loadIndexBundle));
    const out = {
      live: true,
      as_of: null,
      source: 'Yahoo Finance daily closes · ^GSPC / ^NDX · 历年最大回撤',
      windows: WINDOW_DEFS.map((w) => ({ key: w.key, label: w.label })),
      indices: {},
      mdd_ytd: {},
      mdd_annual: {},
      mdd_notes: {
        ndx_history_start: '1985-10',
        ndx_note: '纳斯达克100指数（^NDX）自1985年10月起有日线数据；此前年份无数据。',
        method: '每个自然年内：日线收盘相对年内滚动最高的最大回撤；当年=年初至今。',
      },
    };
    let ok = 0;
    results.forEach((r, i) => {
      const cfg = PRIMARY[i];
      if (r.status !== 'fulfilled') return;
      const bundle = r.value;
      out.indices[cfg.key] = bundle.index;
      if (!out.as_of || bundle.index.as_of > out.as_of) out.as_of = bundle.index.as_of;
      if (bundle.mdd_ytd) out.mdd_ytd[cfg.key] = bundle.mdd_ytd;
      if (bundle.mdd_annual) out.mdd_annual[cfg.key] = bundle.mdd_annual;
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
