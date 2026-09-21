/**
 * Vercel serverless: GET /api/vix — live VIX from CBOE's public delayed-quote
 * CDN (no API key needed). Frontend falls back to /data/vix.json if this fails.
 *
 * ESM export — package.json has "type": "module".
 */

const CBOE_URL = 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json';

/** CBOE last_trade_time → YYYY-MM-DD (their format has varied; parse defensively). */
function toDateOnly(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  // ISO-ish "YYYY-MM-DD..." — take the date part directly
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Epoch seconds or milliseconds
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const round2 = (n) => Math.round(n * 100) / 100;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // VIX only ticks during US hours; 5 min at the edge is plenty and keeps CBOE load tiny
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const r = await fetch(CBOE_URL, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('CBOE HTTP ' + r.status);
    const payload = await r.json();
    const d = payload && payload.data;
    const value = Number(d && d.current_price);
    if (!Number.isFinite(value)) throw new Error('CBOE payload missing current_price');

    const chg = Number(d && d.price_change);
    const chgPct = Number(d && d.price_change_percent);
    const asOf = toDateOnly(d && d.last_trade_time);

    res.status(200).json({
      as_of: asOf,
      value: round2(value),
      chg: Number.isFinite(chg) ? round2(chg) : null,
      chg_pct: Number.isFinite(chgPct) ? round2(chgPct) : null,
      source: 'CBOE delayed quotes (live)',
    });
  } catch (err) {
    res.status(502).json({ error: 'vix upstream failed', detail: String(err && err.message) });
  }
}
