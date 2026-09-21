/**
 * Demo / sample data for the public CryptoTrix site.
 * Snapshot-aligned to 2026-09-19 portfolio CSV (实时价格).
 * Replace via live /api/prices + holdings.json when ready.
 */

export const FUND_CFG = {
  start: '2026-07-16', // Day 1
  goal: 2_000_000,
  handle: 'CRYPTOTRIX1',
  sub: 'US EQUITIES',
  startingCapital: 137_000,
};

/** Holdings with cost basis, weight, snapshot price/MV — 2026-09-19 */
export const DEMO_HOLDINGS = [
  { ticker: 'TSLA',  shares: 101, cost: 216.95, costTotal: 21911.95, price: 328.58, mv: 33186.58, weight: 24.50 },
  { ticker: 'QQQ',   shares: 15,  cost: 566.60, costTotal: 8499.00,  price: 723.03, mv: 10845.45, weight: 7.90 },
  { ticker: 'GOOGL', shares: 30,  cost: 112.06, costTotal: 3361.80,  price: 354.30, mv: 10629.00, weight: 7.89 },
  { ticker: 'VOO',   shares: 14,  cost: 519.22, costTotal: 7269.08,  price: 710.71, mv: 9949.94,  weight: 7.46 },
  { ticker: 'MSFT',  shares: 18,  cost: 360.19, costTotal: 6483.42,  price: 499.99, mv: 8999.82,  weight: 6.71 },
  { ticker: 'NVDA',  shares: 36,  cost: 109.23, costTotal: 3932.28,  price: 223.96, mv: 8062.56,  weight: 5.95 },
  { ticker: 'AMZN',  shares: 17,  cost: 202.06, costTotal: 3435.02,  price: 262.65, mv: 4465.05,  weight: 3.44 },
  { ticker: 'AMD',   shares: 10,  cost: 74.59,  costTotal: 745.90,   price: 483.36, mv: 4833.60,  weight: 3.57 },
  { ticker: 'META',  shares: 6,   cost: 80.39,  costTotal: 482.34,   price: 592.10, mv: 3552.60,  weight: 2.64 },
  { ticker: 'SPCX',  shares: 20,  cost: 136.80, costTotal: 2736.00,  price: 133.11, mv: 2662.20,  weight: 1.97 },
  { ticker: 'PLTR',  shares: 15,  cost: 3.59,   costTotal: 53.85,    price: 172.01, mv: 2580.15,  weight: 1.90 },
  { ticker: 'AAPL',  shares: 6,   cost: 145.25, costTotal: 871.50,   price: 313.33, mv: 1879.98,  weight: 1.41 },
  { ticker: 'EUV',   shares: 50,  cost: 26.50,  costTotal: 1325.00,  price: 26.32,  mv: 1316.00,  weight: 0.97 },
  { ticker: 'BB',    shares: 200, cost: 4.15,   costTotal: 830.00,   price: 8.98,   mv: 1796.00,  weight: 1.33 },
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
};

/**
 * Seed quote map used by the client-side mock / last-resort fallback.
 * Aligned to 2026-09-19 实时价格.
 */
export const DEMO_PRICES = {
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
  EUV:   { price: 26.32,  changePct: 0, hv30: 67.52, weeklyRef: 26.1, monthlyRef: 28.0, yearlyRef: 22.0 },
  BB:    { price: 8.98,   changePct: 0, hv30: 54.79, weeklyRef: 3.55, monthlyRef: 3.20, yearlyRef: 2.40 },
  DRAM:  { price: 58.40,  changePct: 0, hv30: 105, weeklyRef: 56.0, monthlyRef: 52.0, yearlyRef: 40.0 },
  RKLB:  { price: 72.15,  changePct: 0, hv30: 98, weeklyRef: 68.0, monthlyRef: 55.0, yearlyRef: 18.0 },
};

/**
 * Legacy unused sample — portfolio page uses loadHoldingsData() only.
 * Kept snapshot-aligned so accidental imports still match 0919.
 */
export const PORTFOLIO_HOLDINGS = DEMO_HOLDINGS.map((h) => ({
  ticker: h.ticker,
  shares: h.shares,
  cost: h.cost,
  weight: h.weight,
}));
