/**
 * Vercel serverless: GET /api/iv?syms=TSLA,NVDA,QQQ — live (~15 min delayed) 30-day IV.
 *
 * Source order per ticker (no API key):
 *   1. CBOE delayed quote  /quotes/{SYM}.json → data.iv30 (CBOE's own 30-day constant-maturity IV)
 *   2. CBOE delayed chain  /options/{SYM}.json → ATM call/put IV of the expiries bracketing
 *      30 calendar days, interpolated in total variance to 30d
 *   3. Yahoo options (short UA) → ATM IV of the expiry nearest 30d
 * Tickers with no listed options / upstream failure → iv: null.
 * IV rank is NOT computed here (needs a year of IV history; free sources don't provide it).
 *
 * ESM export — package.json has "type": "module".
 */

const CBOE = 'https://cdn.cboe.com/api/global/delayed_quotes';
const UA = 'Mozilla/5.0';
const round1 = (n) => Math.round(n * 10) / 10;
const DAY = 86400000;

async function getJSON(url, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** CBOE quote last_trade_time is ET wall-clock ("2026-10-05T15:59:59"). */
function cboeAsOf(payload) {
  const d = payload && payload.data;
  return (d && d.last_trade_time) || (payload && payload.timestamp) || null;
}

async function fromCboeQuote(sym) {
  const j = await getJSON(`${CBOE}/quotes/${encodeURIComponent(sym)}.json`);
  const iv = Number(j && j.data && j.data.iv30);
  if (!Number.isFinite(iv) || iv <= 0) throw new Error('no iv30');
  return { iv: round1(iv), as_of: cboeAsOf(j), source: 'CBOE iv30' };
}

/** ATM IV (avg of call+put nearest to spot) per expiry → interpolate to 30d. */
function atmTermIV(byExp, spot, nowMs) {
  const pts = [];
  for (const [expMs, strikes] of byExp) {
    const dte = (expMs - nowMs) / DAY;
    if (dte < 3) continue;
    let best = null;
    for (const [k, v] of strikes) {
      if (!(v.c > 0 || v.p > 0)) continue;
      if (!best || Math.abs(k - spot) < Math.abs(best.k - spot)) best = { k, ...v };
    }
    if (!best) continue;
    const ivs = [best.c, best.p].filter((x) => x > 0 && x < 5);
    if (!ivs.length) continue;
    pts.push({ dte, iv: ivs.reduce((a, b) => a + b, 0) / ivs.length });
  }
  if (!pts.length) return null;
  pts.sort((a, b) => a.dte - b.dte);
  const lo = [...pts].reverse().find((p) => p.dte <= 30);
  const hi = pts.find((p) => p.dte >= 30);
  if (lo && hi && hi.dte > lo.dte) {
    // linear in total variance σ²·T
    const v1 = lo.iv ** 2 * lo.dte;
    const v2 = hi.iv ** 2 * hi.dte;
    const v30 = v1 + ((v2 - v1) * (30 - lo.dte)) / (hi.dte - lo.dte);
    return Math.sqrt(Math.max(v30, 0) / 30);
  }
  return (lo || hi).iv;
}

async function fromCboeChain(sym) {
  const j = await getJSON(`${CBOE}/options/${encodeURIComponent(sym)}.json`, 12000);
  const d = j && j.data;
  const spot = Number(d && d.current_price);
  if (!Number.isFinite(spot) || !Array.isArray(d.options)) throw new Error('bad chain');
  const byExp = new Map();
  for (const o of d.options) {
    const m = /(\d{6})([CP])(\d{8})$/.exec(o.option || '');
    if (!m) continue;
    const iv = Number(o.iv);
    if (!(iv > 0)) continue;
    const exp = Date.UTC(2000 + +m[1].slice(0, 2), +m[1].slice(2, 4) - 1, +m[1].slice(4, 6), 20);
    const k = +m[3] / 1000;
    if (!byExp.has(exp)) byExp.set(exp, new Map());
    const s = byExp.get(exp);
    if (!s.has(k)) s.set(k, {});
    s.get(k)[m[2] === 'C' ? 'c' : 'p'] = iv;
  }
  const iv = atmTermIV(byExp, spot, Date.now());
  if (iv == null) throw new Error('no atm iv');
  return { iv: round1(iv * 100), as_of: j.timestamp || null, source: 'CBOE chain ATM' };
}

async function fromYahoo(sym) {
  const ys = sym.replace(/\./g, '-');
  const base = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ys)}`;
  const first = await getJSON(base);
  const r0 = first && first.optionChain && first.optionChain.result && first.optionChain.result[0];
  if (!r0 || !r0.expirationDates || !r0.expirationDates.length) throw new Error('no yahoo chain');
  const spot = Number(r0.quote && r0.quote.regularMarketPrice);
  const target = Date.now() / 1000 + 30 * 86400;
  const exp = r0.expirationDates.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const j = await getJSON(base + '?date=' + exp);
  const o = j.optionChain.result[0].options[0];
  const strikes = new Map();
  for (const [arr, side] of [[o.calls || [], 'c'], [o.puts || [], 'p']]) {
    for (const c of arr) {
      if (!(c.impliedVolatility > 0)) continue;
      if (!strikes.has(c.strike)) strikes.set(c.strike, {});
      strikes.get(c.strike)[side] = c.impliedVolatility;
    }
  }
  const iv = atmTermIV(new Map([[exp * 1000, strikes]]), spot, Date.now());
  if (iv == null) throw new Error('no yahoo atm iv');
  return { iv: round1(iv * 100), as_of: new Date().toISOString(), source: 'Yahoo ATM' };
}

async function ivFor(sym) {
  const errs = [];
  for (const fn of [fromCboeQuote, fromCboeChain, fromYahoo]) {
    try {
      return await fn(sym);
    } catch (e) {
      errs.push(fn.name + ': ' + String(e && e.message));
    }
  }
  return { iv: null, as_of: null, source: null, error: errs.join('; ') };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  const raw = String((req.query && (req.query.syms || req.query.symbols)) || '');
  const syms = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)))].slice(0, 30);
  if (!syms.length) {
    res.status(400).json({ error: 'syms required, e.g. /api/iv?syms=TSLA,QQQ' });
    return;
  }
  const out = await Promise.all(syms.map(async (s) => [s, await ivFor(s)]));
  res.status(200).json({
    fetched_at: new Date().toISOString(),
    note: 'iv = 30-day implied vol in %, ~15 min delayed (CBOE). as_of = last trade time ET.',
    data: Object.fromEntries(out),
  });
}
