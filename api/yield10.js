/**
 * Vercel serverless: GET /api/yield10 — US 10Y Treasury constant-maturity
 * yield, daily series from FRED's public CSV endpoint (no API key needed).
 * Fallback upstream: Treasury.gov daily yield-curve CSV. If both fail the
 * frontend falls back to the /data/yield10.json snapshot.
 *
 * DGS10 = 10-Year Treasury Constant Maturity Rate (percent, daily).
 * ESM export — package.json has "type": "module".
 */

const FRED_URL = (cosd) =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=${cosd}`;
const TREASURY_URL = (year) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

const round2 = (n) => Math.round(n * 100) / 100;

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Daily series — 10 min at the edge keeps upstream load tiny
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=21600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  let series = [];
  let source = null;
  try {
    const r = await fetch(FRED_URL(isoDaysAgo(400)), { headers: { accept: 'text/csv' } });
    if (!r.ok) throw new Error('FRED HTTP ' + r.status);
    series = parseFred(await r.text());
    if (series.length) source = 'FRED · DGS10 (daily)';
  } catch {
    /* try treasury fallback below */
  }

  if (!series.length) {
    try {
      const year = new Date().getFullYear();
      const r = await fetch(TREASURY_URL(year), { headers: { accept: 'text/csv' } });
      if (!r.ok) throw new Error('Treasury HTTP ' + r.status);
      series = parseTreasury(await r.text());
      if (series.length) source = 'U.S. Treasury daily yield curve (daily)';
    } catch {
      /* fall through to 502 */
    }
  }

  if (series.length < 2) {
    res.status(502).json({ error: 'yield10 upstream failed' });
    return;
  }

  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const chg = round2(last.v - prev.v);
  const chgPct = prev.v ? round2(((last.v - prev.v) / prev.v) * 100) : null;

  // Sparkline window: last 90 observations; range context: full fetched window (~52w)
  const history = series.slice(-90);
  const lo = round2(Math.min(...series.map((p) => p.v)));
  const hi = round2(Math.max(...series.map((p) => p.v)));
  const hLo = round2(Math.min(...history.map((p) => p.v)));
  const hHi = round2(Math.max(...history.map((p) => p.v)));

  res.status(200).json({
    as_of: last.date,
    value: last.v,
    prev: prev.v,
    chg,
    chg_pct: chgPct,
    history,
    lo_52w: lo,
    hi_52w: hi,
    lo_90d: hLo,
    hi_90d: hHi,
    source,
  });
}
