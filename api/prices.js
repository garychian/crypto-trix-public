/**
 * Vercel serverless for GET /api/prices?symbols=TSLA,NVDA,BRK.B&hist=1
 *
 * Live mode: set FINNHUB_TOKEN in Vercel env (Project → Settings → Environment
 * Variables). Quotes come from Finnhub /quote (free tier, ~real-time US equities)
 * and are merged over the static snapshot so hv30 / weeklyRef / … stay available.
 * No token or upstream failure → snapshot quotes (source: 'snapshot').
 *
 * Never commit the token; it is injected via Vercel env only.
 * ESM export — package.json has "type": "module".
 */

const SNAPSHOT = {
  TSLA:  { price: 364.27, changePct: 0, hv30: 59.94, weeklyRef: 328.4, monthlyRef: 315.2, yearlyRef: 248.5 },
  QQQ:   { price: 721.45, changePct: 0, hv30: 18.06, weeklyRef: 708.1, monthlyRef: 692.0, yearlyRef: 520.0 },
  GOOGL: { price: 349.54, changePct: 0, hv30: 37.00, weeklyRef: 348.2, monthlyRef: 332.5, yearlyRef: 175.0 },
  VOO:   { price: 701.78, changePct: 0, hv30: 10.99, weeklyRef: 702.4, monthlyRef: 690.1, yearlyRef: 520.0 },
  MSFT:  { price: 493.78, changePct: 0, hv30: 47.01, weeklyRef: 475.0, monthlyRef: 458.2, yearlyRef: 380.0 },
  NVDA:  { price: 222.27, changePct: 0, hv30: 44.29, weeklyRef: 208.5, monthlyRef: 195.0, yearlyRef: 120.0 },
  AMZN:  { price: 253.71, changePct: 0, hv30: 50.38, weeklyRef: 264.0, monthlyRef: 245.0, yearlyRef: 180.0 },
  AMD:   { price: 559.82, changePct: 0, hv30: 66.92, weeklyRef: 483.0, monthlyRef: 420.0, yearlyRef: 160.0 },
  META:  { price: 665.75, changePct: 0, hv30: 41.07, weeklyRef: 538.0, monthlyRef: 510.0, yearlyRef: 380.0 },
  SPCX:  { price: 152.71, changePct: 0, hv30: 82.89, weeklyRef: 142.5, monthlyRef: 125.0, yearlyRef: 90.0 },
  PLTR:  { price: 177.64, changePct: 0, hv30: 91.83, weeklyRef: 160.0, monthlyRef: 148.0, yearlyRef: 65.0 },
  AAPL:  { price: 336.13, changePct: 0, hv30: 30.64, weeklyRef: 313.0, monthlyRef: 280.0, yearlyRef: 185.0 },
  'BRK.B': { price: 509.77, changePct: 0, hv30: 18.5, weeklyRef: 505.0, monthlyRef: 490.0, yearlyRef: 420.0 },
  EUV:   { price: 23.60, changePct: 0, hv30: 67.52, weeklyRef: 26.1, monthlyRef: 28.0, yearlyRef: 22.0 },
  // Harmless leftover; no longer in holdings
  BB:    { price: 8.98, changePct: 0, hv30: 54.79, weeklyRef: 3.55, monthlyRef: 3.20, yearlyRef: 2.40 },
  DRAM:  { price: 58.40, changePct: 0, hv30: 105, weeklyRef: 56.0, monthlyRef: 52.0, yearlyRef: 40.0 },
  RKLB:  { price: 72.15, changePct: 0, hv30: 98, weeklyRef: 68.0, monthlyRef: 55.0, yearlyRef: 18.0 },
};

const round2 = (n) => Math.round(n * 100) / 100;

async function finnhubQuote(symbol, token) {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
    { headers: { accept: 'application/json' } }
  );
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const q = await r.json();
  const price = Number(q && q.c);
  if (!Number.isFinite(price) || price <= 0) throw new Error('no quote');
  const dp = Number(q && q.dp);
  return { price: round2(price), changePct: Number.isFinite(dp) ? round2(dp) : 0 };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Quotes tick during US hours; 60s at the edge keeps Finnhub free-tier usage tiny
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const symbols = String((req.query && req.query.symbols) || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const keys = symbols.length ? symbols : Object.keys(SNAPSHOT);

  const token = process.env.FINNHUB_TOKEN;
  const out = {};

  if (token) {
    const results = await Promise.allSettled(
      keys.map((sym) => finnhubQuote(sym, token))
    );
    let hits = 0;
    keys.forEach((sym, i) => {
      const base = SNAPSHOT[sym]
        ? Object.assign({}, SNAPSHOT[sym])
        : { price: null, changePct: null };
      const r = results[i];
      if (r.status === 'fulfilled') {
        out[sym] = Object.assign(base, r.value);
        hits++;
      } else {
        out[sym] = SNAPSHOT[sym]
          ? base
          : { error: 'no quote', price: null, changePct: null };
      }
    });
    if (hits > 0) {
      out.__source = 'live';
      res.status(200).json(out);
      return;
    }
    // Finnhub fully down → fall through to snapshot
  }

  for (const sym of keys) {
    out[sym] = SNAPSHOT[sym]
      ? Object.assign({}, SNAPSHOT[sym])
      : { error: 'unknown symbol', price: null, changePct: null };
  }
  out.__source = 'snapshot';
  res.status(200).json(out);
}
