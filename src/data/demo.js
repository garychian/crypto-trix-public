/**
 * Demo / sample data for the public CryptoTrix site.
 * Mirrors the shape used by the original Wealth Freedom Fund dashboard.
 * Replace via live /api/prices + your own holdings feed when ready.
 */

export const FUND_CFG = {
  start: '2026-07-16', // Day 1
  goal: 2_000_000,
  handle: 'CRYPTOTRIX1',
  sub: 'US EQUITIES',
  startingCapital: 137_000,
};

/** Holdings with cost basis, weight, snapshot price/MV — realistic demo */
export const DEMO_HOLDINGS = [
  { ticker: 'TSLA',  shares: 101, cost: 216.95, costTotal: 21912.42, price: 341.60, mv: 34501.60, weight: 25.26 },
  { ticker: 'QQQ',   shares: 15,  cost: 566.60, costTotal: 8389.31,  price: 715.27, mv: 10590.57, weight: 7.75 },
  { ticker: 'GOOGL', shares: 30,  cost: 112.06, costTotal: 3380.34,  price: 343.11, mv: 10350.15, weight: 7.58 },
  { ticker: 'VOO',   shares: 14,  cost: 519.22, costTotal: 7382.91,  price: 707.86, mv: 10065.31, weight: 7.37 },
  { ticker: 'MSFT',  shares: 18,  cost: 360.19, costTotal: 6544.45,  price: 482.02, mv: 8757.93,  weight: 6.41 },
  { ticker: 'NVDA',  shares: 36,  cost: 109.23, costTotal: 3932.13,  price: 218.21, mv: 7855.56,  weight: 5.75 },
  { ticker: 'AMZN',  shares: 17,  cost: 202.06, costTotal: 3435.04,  price: 261.57, mv: 4446.69,  weight: 3.26 },
  { ticker: 'AMD',   shares: 10,  cost: 74.59,  costTotal: 745.85,   price: 164.23, mv: 1642.30,  weight: 1.20 },
  { ticker: 'META',  shares: 6,   cost: 80.39,  costTotal: 484.88,   price: 547.13, mv: 3282.78,  weight: 2.40 },
  { ticker: 'SPCX',  shares: 20,  cost: 136.80, costTotal: 2736.00,  price: 138.83, mv: 2776.60,  weight: 2.03 },
  { ticker: 'PLTR',  shares: 15,  cost: 3.59,   costTotal: 53.80,    price: 171.40, mv: 2571.00,  weight: 1.88 },
  { ticker: 'AAPL',  shares: 6,   cost: 145.25, costTotal: 884.40,   price: 226.98, mv: 1361.88,  weight: 1.00 },
  { ticker: 'EUV',   shares: 50,  cost: 26.50,  costTotal: 1325.00,  price: 24.66,  mv: 1233.00,  weight: 0.90 },
  { ticker: 'BB',    shares: 200, cost: 4.15,   costTotal: 830.00,   price: 3.86,   mv: 772.00,   weight: 0.57 },
];

/** Cash secured puts — demo rows */
export const DEMO_OPTIONS = [
  { symbol: 'DRAM', type: 'SELL PUT', strike: 50,  expiry: '2026-09-18', premium: 479 },
  { symbol: 'RKLB', type: 'SELL PUT', strike: 60,  expiry: '2027-06-17', premium: 1740 },
  { symbol: 'SPCX', type: 'SELL PUT', strike: 100, expiry: '2026-12-18', premium: 657 },
  { symbol: 'EUV',  type: 'SELL PUT', strike: 27,  expiry: '2026-08-21', premium: 125 },
  { symbol: 'EUV',  type: 'SELL PUT', strike: 24,  expiry: '2026-07-17', premium: 62 },
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
 * Seed quote map used by the client-side mock.
 * Shape matches the old /api/prices response:
 * { TICKER: { price, changePct, hv30?, weeklyRef?, monthlyRef?, yearlyRef? } }
 */
export const DEMO_PRICES = {
  TSLA:  { price: 341.60, changePct: 1.82, hv30: 59.94, weeklyRef: 328.4, monthlyRef: 315.2, yearlyRef: 248.5 },
  QQQ:   { price: 715.27, changePct: 0.41, hv30: 18.06, weeklyRef: 708.1, monthlyRef: 692.0, yearlyRef: 520.0 },
  GOOGL: { price: 343.11, changePct: -0.68, hv30: 37.00, weeklyRef: 348.2, monthlyRef: 332.5, yearlyRef: 175.0 },
  VOO:   { price: 707.86, changePct: 0.22, hv30: 10.99, weeklyRef: 702.4, monthlyRef: 690.1, yearlyRef: 520.0 },
  MSFT:  { price: 482.02, changePct: 0.55, hv30: 47.01, weeklyRef: 475.0, monthlyRef: 458.2, yearlyRef: 380.0 },
  NVDA:  { price: 218.21, changePct: 2.14, hv30: 44.29, weeklyRef: 208.5, monthlyRef: 195.0, yearlyRef: 120.0 },
  AMZN:  { price: 261.57, changePct: -0.35, hv30: 50.38, weeklyRef: 264.0, monthlyRef: 245.0, yearlyRef: 180.0 },
  AMD:   { price: 164.23, changePct: 1.05, hv30: 66.92, weeklyRef: 158.2, monthlyRef: 145.0, yearlyRef: 110.0 },
  META:  { price: 547.13, changePct: 0.88, hv30: 41.07, weeklyRef: 538.0, monthlyRef: 510.0, yearlyRef: 380.0 },
  SPCX:  { price: 138.83, changePct: -1.42, hv30: 82.89, weeklyRef: 142.5, monthlyRef: 125.0, yearlyRef: 90.0 },
  PLTR:  { price: 171.40, changePct: 3.25, hv30: 91.83, weeklyRef: 160.0, monthlyRef: 148.0, yearlyRef: 65.0 },
  AAPL:  { price: 226.98, changePct: 0.18, hv30: 30.64, weeklyRef: 224.5, monthlyRef: 218.0, yearlyRef: 185.0 },
  EUV:   { price: 24.66,  changePct: -2.10, hv30: 67.52, weeklyRef: 26.1, monthlyRef: 28.0, yearlyRef: 22.0 },
  BB:    { price: 3.86,   changePct: 4.60, hv30: 54.79, weeklyRef: 3.55, monthlyRef: 3.20, yearlyRef: 2.40 },
  DRAM:  { price: 58.40,  changePct: 0.75, hv30: 105, weeklyRef: 56.0, monthlyRef: 52.0, yearlyRef: 40.0 },
  RKLB:  { price: 72.15,  changePct: 1.90, hv30: 98, weeklyRef: 68.0, monthlyRef: 55.0, yearlyRef: 18.0 },
};

/** Portfolio Map sample (weights-focused EN dashboard) */
export const PORTFOLIO_HOLDINGS = [
  { ticker: 'NVDA',  shares: 80,  cost: 118.2, weight: 22.0 },
  { ticker: 'TSLA',  shares: 60,  cost: 242.8, weight: 18.5 },
  { ticker: 'AAPL',  shares: 120, cost: 175.3, weight: 15.0 },
  { ticker: 'GOOGL', shares: 40,  cost: 138.5, weight: 10.0 },
  { ticker: 'RKLB',  shares: 300, cost: 23.5,  weight: 8.0 },
  { ticker: 'META',  shares: 12,  cost: 420.0, weight: 6.5 },
  { ticker: 'MSFT',  shares: 18,  cost: 360.0, weight: 6.0 },
  { ticker: 'AMZN',  shares: 20,  cost: 180.0, weight: 5.0 },
  { ticker: 'SPCX',  shares: 200, cost: 18.0,  weight: 4.5 },
  { ticker: 'PLTR',  shares: 80,  cost: 25.0,  weight: 3.0 },
  { ticker: 'AMD',   shares: 25,  cost: 110.0, weight: 1.5 },
];
