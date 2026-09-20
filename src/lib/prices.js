/**
 * Price loader with demo fallback.
 *
 * Response shape (same as the original site):
 * {
 *   TSLA: { price, changePct, hv30?, weeklyRef?, monthlyRef?, yearlyRef?, error? },
 *   ...
 * }
 *
 * How to plug in live prices:
 * 1. Deploy a serverless handler at /api/prices (see /api/prices.js).
 * 2. Set VITE_PRICES_URL=/api/prices (or leave default).
 * 3. When the live endpoint is reachable, it wins; otherwise demo prices load.
 */

import { DEMO_PRICES } from '../data/demo.js';

const LIVE_URL = import.meta.env.VITE_PRICES_URL || '/api/prices';
const USE_DEMO_ONLY = import.meta.env.VITE_DEMO_ONLY === '1';

function pickDemo(symbols) {
  const out = {};
  for (const sym of symbols) {
    const key = String(sym).toUpperCase();
    if (DEMO_PRICES[key]) {
      out[key] = { ...DEMO_PRICES[key] };
    } else {
      out[key] = { error: 'no demo quote', price: null, changePct: null };
    }
  }
  return out;
}

/**
 * @param {string[]} symbols
 * @param {{ hist?: boolean }} [opts]
 */
export async function fetchPrices(symbols, opts = {}) {
  const list = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (!list.length) return {};

  if (USE_DEMO_ONLY) {
    return { ...pickDemo(list), __source: 'demo' };
  }

  try {
    const qs = new URLSearchParams({ symbols: list.join(',') });
    if (opts.hist) qs.set('hist', '1');
    const res = await fetch(`${LIVE_URL}?${qs.toString()}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    // Merge missing symbols from demo so the UI stays alive
    const merged = { ...pickDemo(list), ...json, __source: 'live' };
    return merged;
  } catch {
    return { ...pickDemo(list), __source: 'demo' };
  }
}

export function priceSourceLabel(prices) {
  return prices?.__source === 'live' ? 'live' : 'demo';
}
