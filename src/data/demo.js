/**
 * Demo / sample data for the public CryptoTrix site.
 * Snapshot-aligned to 2026-09-20 portfolio CSV (my-portfolio.csv).
 * Replace via live /api/prices + holdings.json when ready.
 */

export const FUND_CFG = {
  start: '2026-07-16', // Day 1
  goal: 2_000_000,
  handle: 'CRYPTOTRIX1',
  sub: 'US EQUITIES',
  startingCapital: 137_000,
};

/** Holdings with cost basis, weight, snapshot price/MV — 2026-09-20 */
export const DEMO_HOLDINGS = [
  { ticker: 'TSLA',  shares: 101,   cost: 216.95, costTotal: 21911.95, price: 364.27, mv: 36791.27, weight: 25.63 },
  { ticker: 'QQQ',   shares: 15.14, cost: 600.44, costTotal: 9090.66,  price: 721.45, mv: 10922.75, weight: 7.61 },
  { ticker: 'GOOGL', shares: 30.17, cost: 112.06, costTotal: 3380.85,  price: 349.54, mv: 10545.62, weight: 7.35 },
  { ticker: 'VOO',   shares: 14.22, cost: 519.22, costTotal: 7383.31,  price: 701.78, mv: 9979.31,  weight: 6.95 },
  { ticker: 'MSFT',  shares: 18.17, cost: 360.19, costTotal: 6544.65,  price: 493.78, mv: 8971.98,  weight: 6.25 },
  { ticker: 'NVDA',  shares: 36,    cost: 109.23, costTotal: 3932.28,  price: 222.27, mv: 8001.72,  weight: 5.57 },
  { ticker: 'AMD',   shares: 10,    cost: 74.59,  costTotal: 745.90,   price: 559.82, mv: 5598.20,  weight: 3.90 },
  { ticker: 'AMZN',  shares: 17,    cost: 202.06, costTotal: 3435.02,  price: 253.71, mv: 4313.07,  weight: 3.00 },
  { ticker: 'META',  shares: 6.03,  cost: 80.39,  costTotal: 484.75,   price: 665.75, mv: 4014.47,  weight: 2.80 },
  { ticker: 'SPCX',  shares: 20,    cost: 136.80, costTotal: 2736.00,  price: 152.71, mv: 3054.20,  weight: 2.13 },
  { ticker: 'PLTR',  shares: 15,    cost: 3.59,   costTotal: 53.85,    price: 177.64, mv: 2664.60,  weight: 1.86 },
  { ticker: 'AAPL',  shares: 6.09,  cost: 145.25, costTotal: 884.57,   price: 336.13, mv: 2047.03,  weight: 1.43 },
  { ticker: 'BRK.B', shares: 2,     cost: 515.00, costTotal: 1030.00,  price: 509.77, mv: 1019.54,  weight: 0.71 },
  { ticker: 'EUV',   shares: 60,    cost: 25.85,  costTotal: 1551.00,  price: 23.60,  mv: 1416.00,  weight: 0.99 },
];

/** Cash secured puts — aligned with holdings.json options */
export const DEMO_OPTIONS = [
  { symbol: 'DRAM', type: 'SELL PUT', strike: 50,  expiry: '2026-11-20', premium: 789 },
  { symbol: 'RKLB', type: 'SELL PUT', strike: 60,  expiry: '2027-06-17', premium: 1740 },
  { symbol: 'SPCX', type: 'SELL PUT', strike: 100, expiry: '2027-01-15', premium: 719 },
  { symbol: 'EUV',  type: 'SELL PUT', strike: 27,  expiry: '2026-10-16', premium: 260 },
];

export const DEMO_CASH = 32038;

/** Manual notes overlay (optional) */
export const DEMO_NOTES = {
  TSLA: '核心仓 · 守$330 · 自动驾驶叙事',
  NVDA: 'AI 基建 · 波动中加仓观察',
  GOOGL: '云 + DeepMind · 中期持有',
  SPCX: '太空主题 · 解禁窗口关注',
  PLTR: '政府/商业双轮 · 高波动',
  'BRK.B': '价值底仓 · 长期持有',
};

/**
 * Seed quote map used by the client-side mock / last-resort fallback.
 * Aligned to 2026-09-20 实时价格 (my-portfolio.csv).
 */
export const DEMO_PRICES = {
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
  EUV:   { price: 23.60,  changePct: 0, hv30: 67.52, weeklyRef: 26.1, monthlyRef: 28.0, yearlyRef: 22.0 },
  // Harmless leftover; no longer in holdings
  BB:    { price: 8.98,   changePct: 0, hv30: 54.79, weeklyRef: 3.55, monthlyRef: 3.20, yearlyRef: 2.40 },
  DRAM:  { price: 58.40,  changePct: 0, hv30: 105, weeklyRef: 56.0, monthlyRef: 52.0, yearlyRef: 40.0 },
  RKLB:  { price: 72.15,  changePct: 0, hv30: 98, weeklyRef: 68.0, monthlyRef: 55.0, yearlyRef: 18.0 },
};

/**
 * Legacy unused sample — portfolio page uses loadHoldingsData() only.
 * Kept snapshot-aligned so accidental imports still match 2026-09-20.
 */
export const PORTFOLIO_HOLDINGS = DEMO_HOLDINGS.map((h) => ({
  ticker: h.ticker,
  shares: h.shares,
  cost: h.cost,
  weight: h.weight,
}));
