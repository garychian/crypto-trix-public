/**
 * Vercel serverless stub for GET /api/prices?symbols=TSLA,NVDA&hist=1
 *
 * Default: returns 2026-09-19 snapshot-aligned quotes (no brokerage credentials).
 * To go live: set FINNHUB_TOKEN or TIINGO_TOKEN in Vercel env and implement
 * the provider branch below. Never commit secrets.
 *
 * ESM export — package.json has "type": "module".
 */

const DEMO = {
  TSLA:  { price: 328.58, changePct: 0, hv30: 59.94, weeklyRef: 328.4, monthlyRef: 315.2, yearlyRef: 248.5 },
  QQQ:   { price: 723.03, changePct: 0, hv30: 18.06, weeklyRef: 708.1, monthlyRef: 692.0, yearlyRef: 520.0 },
  GOOGL: { price: 354.30, changePct: 0, hv30: 37.00, weeklyRef: 348.2, monthlyRef: 332.5, yearlyRef: 175.0 },
  VOO:   { price: 710.71, changePct: 0, hv30: 10.99, weeklyRef: 702.4, monthlyRef: 690.1, yearlyRef: 520.0 },
  MSFT:  { price: 499.99, changePct: 0, hv30: 47.01, weeklyRef: 475.0, monthlyRef: 458.2, yearlyRef: 380.0 },
  NVDA:  { price: 223.96, changePct: 0, hv30: 44.29, weeklyRef: 208.5, monthlyRef: 195.0, yearlyRef: 120.0 },
  AMZN:  { price: 262.65, changePct: 0, hv30: 50.38, weeklyRef: 264.0, monthlyRef: 245.0, yearlyRef: 180.0 },
  AMD:   { price: 483.36, changePct: 0, hv30: 66.92, weeklyRef: 158.2, monthlyRef: 145.0, yearlyRef: 110.0 },
  META:  { price: 592.10, changePct: 0, hv30: 41.07, weeklyRef: 538.0, monthlyRef: 510.0, yearlyRef: 380.0 },
  SPCX:  { price: 133.11, changePct: 0, hv30: 82.89, weeklyRef: 142.5, monthlyRef: 125.0, yearlyRef: 90.0 },
  PLTR:  { price: 172.01, changePct: 0, hv30: 91.83, weeklyRef: 160.0, monthlyRef: 148.0, yearlyRef: 65.0 },
  AAPL:  { price: 313.33, changePct: 0, hv30: 30.64, weeklyRef: 224.5, monthlyRef: 218.0, yearlyRef: 185.0 },
  EUV:   { price: 26.32, changePct: 0, hv30: 67.52, weeklyRef: 26.1, monthlyRef: 28.0, yearlyRef: 22.0 },
  BB:    { price: 8.98, changePct: 0, hv30: 54.79, weeklyRef: 3.55, monthlyRef: 3.20, yearlyRef: 2.40 },
  DRAM:  { price: 58.40, changePct: 0, hv30: 105, weeklyRef: 56.0, monthlyRef: 52.0, yearlyRef: 40.0 },
  RKLB:  { price: 72.15, changePct: 0, hv30: 98, weeklyRef: 68.0, monthlyRef: 55.0, yearlyRef: 18.0 },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const symbols = String((req.query && req.query.symbols) || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  // Live provider hook (optional). Implement when tokens are set in Vercel env.
  // const token = process.env.FINNHUB_TOKEN || process.env.TIINGO_TOKEN;

  const keys = symbols.length ? symbols : Object.keys(DEMO);
  const out = {};
  for (const sym of keys) {
    out[sym] = DEMO[sym]
      ? Object.assign({}, DEMO[sym])
      : { error: 'unknown symbol', price: null, changePct: null };
  }
  out.__source = 'snapshot';
  res.status(200).json(out);
}
