/**
 * Vercel serverless: GET /api/yield10 — US 10Y Treasury yield.
 *
 * Intraday first: CBOE's public delayed-quote CDN hosts the TNX index
 * (10Y yield × 10), same free source as /api/vix — gives a ticking value
 * during US hours. Daily context (sparkline, 52w range, previous close for
 * the change calc) comes from FRED's public DGS10 CSV, with Treasury.gov's
 * daily yield-curve CSV as a secondary fallback. If everything upstream
 * fails the frontend falls back to the /data/yield10.json snapshot.
 *
 * ESM export — package.json has "type": "module".
 */

const CBOE_TNX_URL = 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/_TNX.json';
const FRED_URL = (cosd) =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=${cosd}`;
const TREASURY_URL = (year) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

const round2 = (n) => Math.round(n * 100) / 100;

/** CBOE last_trade_time → { date: "YYYY-MM-DD", time: "HH:MM" } (its own ET offset). */
function toET(raw) {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(raw || ''));
  if (!m) return { date: null, time: null };
  return { date: m[1], time: m[2] };
}

/** Parse FRED CSV ("observation_date,DGS10", missing days are "."). */
function parseFred(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const m = /^(\d{4}-\d{2}-\d{2}),(.+)$/.exec(line.trim());
    if (!m) continue;
    const v = Number(m[2]);
    if (Number.isFinite(v)) out.push({ date: m[1], v: round2(v) });
  }
  return out;
}

/** Parse Treasury.gov CSV ("Date,1 Mo,...,10 Yr,..." → 10 Yr column). */
function parseTreasury(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const cols = lines[0].split(',').map((c) => c.trim());
  const idx = cols.indexOf('10 Yr');
  if (idx < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const d = String(cells[0] || '').trim(); // "MM/DD/YYYY"
    const v = Number(cells[idx]);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
    if (!m || !Number.isFinite(v)) continue;
    out.push({ date: `${m[3]}-${m[1]}-${m[2]}`, v: round2(v) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function loadDailySeries() {
  try {
    const r = await fetch(FRED_URL(isoDaysAgo(400)), { headers: { accept: 'text/csv' } });
    if (r.ok) {
      const series = parseFred(await r.text());
      if (series.length) return { series, source: 'FRED · DGS10' };
    }
  } catch {
    /* treasury fallback below */
  }
  try {
    const year = new Date().getFullYear();
    const r = await fetch(TREASURY_URL(year), { headers: { accept: 'text/csv' } });
    if (r.ok) {
      const series = parseTreasury(await r.text());
      if (series.length) return { series, source: 'U.S. Treasury daily yield curve' };
    }
  } catch {
    /* fall through */
  }
  return { series: [], source: null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const daily = await loadDailySeries();

  // Intraday live tick (CBOE TNX = yield × 10)
  let live = null;
  try {
    const r = await fetch(CBOE_TNX_URL, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const payload = await r.json();
      const d = payload && payload.data;
      const raw = Number(d && d.current_price);
      if (Number.isFinite(raw) && raw > 0) {
        const et = toET(d && d.last_trade_time);
        // Change vs the previous trading day's official close: prefer CBOE's own
        // price_change when usable, else diff against the last daily close before
        // the trade date.
        let chg = Number(d && d.price_change);
        if (!Number.isFinite(chg) || chg === 0 || !d.prev_day_close) {
          const prior = daily.series.filter((p) => !et.date || p.date < et.date);
          const ref = prior[prior.length - 1];
          chg = ref ? raw / 10 - ref.v : NaN;
        } else {
          chg = chg / 10;
        }
        live = {
          value: round2(raw / 10),
          chg: Number.isFinite(chg) ? round2(chg) : null,
          last_trade: String((d && d.last_trade_time) || '').trim() || null,
          trade_date: et.date,
          trade_time: et.time,
        };
      }
    }
  } catch {
    /* fall through to daily-only */
  }

  const series = daily.series;
  if (!live && series.length < 2) {
    res.status(502).json({ error: 'yield10 upstream failed' });
    return;
  }

  const last = series[series.length - 1];
  const prev = series[series.length - 2];

  // Value/chg: intraday tick when available, else the daily close
  const value = live ? live.value : last.v;
  const chg = live && Number.isFinite(live.chg) ? live.chg : round2(last.v - prev.v);
  const refV = value - chg; // the previous close the change is measured against
  const chgPct = refV ? round2((chg / refV) * 100) : null;

  // Sparkline window: last 90 daily observations; range context: ~52w
  const history = series.slice(-90);
  const lo = round2(Math.min(...series.map((p) => p.v)));
  const hi = round2(Math.max(...series.map((p) => p.v)));
  const hLo = round2(Math.min(...history.map((p) => p.v)));
  const hHi = round2(Math.max(...history.map((p) => p.v)));

  res.status(200).json({
    live: Boolean(live),
    as_of: live ? live.trade_date : last.date,
    trade_time: live ? live.trade_time : null,
    value,
    prev: prev.v,
    chg,
    chg_pct: chgPct,
    history,
    lo_52w: lo,
    hi_52w: hi,
    lo_90d: hLo,
    hi_90d: hHi,
    source: live
      ? `CBOE TNX (delayed ~15min) · daily context: ${daily.source || 'n/a'}`
      : daily.source || null,
  });
}
