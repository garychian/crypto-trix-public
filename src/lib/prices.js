/**
 * Price loader with snapshot-first fallback.
 *
 * Priority:
 * 1. Live /api/prices (when reachable)
 * 2. Snapshot prices from loaded holdings / holdings.json
 * 3. DEMO_PRICES (last resort)
 *
 * Response shape:
 * {
 *   TSLA: { price, changePct, hv30?, weeklyRef?, monthlyRef?, yearlyRef?, error? },
 *   ...
 *   __source: 'live' | 'snapshot' | 'demo'
 * }
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
 * Build a quote map from holdings rows and/or a prices map on holdings.json.
 * @param {object[]} holdings
 * @param {Record<string, number>|null} [pricesMap]
 */
export function pricesFromHoldings(holdings, pricesMap = null) {
  const out = {};
  if (pricesMap && typeof pricesMap === 'object') {
    for (const [sym, price] of Object.entries(pricesMap)) {
      const key = String(sym).toUpperCase();
      const p = Number(price);
      if (Number.isFinite(p)) {
        out[key] = { price: p, changePct: 0 };
      }
    }
  }
  for (const h of holdings || []) {
    const key = String(h.ticker || h.symbol || '').toUpperCase();
    if (!key) continue;
    if (h.price != null && Number.isFinite(Number(h.price))) {
      const base = DEMO_PRICES[key] ? { ...DEMO_PRICES[key] } : {};
      out[key] = {
        ...base,
        price: Number(h.price),
        changePct: h.changePct != null ? Number(h.changePct) : 0,
      };
    }
  }
  return out;
}

function pickSnapshot(symbols, snapshot) {
  const out = {};
  let hits = 0;
  for (const sym of symbols) {
    const key = String(sym).toUpperCase();
    if (snapshot && snapshot[key] && snapshot[key].price != null) {
      out[key] = { ...snapshot[key] };
      hits++;
    }
  }
  return { out, hits };
}

/**
 * @param {string[]} symbols
 * @param {{ hist?: boolean, snapshot?: Record<string, object> }} [opts]
 */
export async function fetchPrices(symbols, opts = {}) {
  const list = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (!list.length) return {};

  const snapshot = opts.snapshot || null;

  if (USE_DEMO_ONLY) {
    const { out, hits } = pickSnapshot(list, snapshot);
    if (hits > 0) {
      const merged = { ...pickDemo(list), ...out, __source: 'snapshot' };
      return merged;
    }
    return { ...pickDemo(list), __source: 'demo' };
  }

  try {
    const qs = new URLSearchParams({ symbols: list.join(',') });
    if (opts.hist) qs.set('hist', '1');
    const res = await fetch(`${LIVE_URL}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const apiSource = json.__source === 'snapshot' ? 'snapshot' : 'live';
    // Fill gaps from snapshot then demo
    const { out: snapFill } = pickSnapshot(list, snapshot);
    const merged = {
      ...pickDemo(list),
      ...snapFill,
      ...json,
      __source: apiSource,
    };
    return merged;
  } catch {
    const { out, hits } = pickSnapshot(list, snapshot);
    if (hits > 0) {
      return { ...pickDemo(list), ...out, __source: 'snapshot' };
    }
    return { ...pickDemo(list), __source: 'demo' };
  }
}

export function priceSourceLabel(prices) {
  const s = prices?.__source;
  if (s === 'live') return 'live';
  if (s === 'snapshot') return 'snapshot';
  return 'demo';
}

/** Human-readable price source for badges */
export function priceSourceBadge(prices) {
  const s = priceSourceLabel(prices);
  if (s === 'live') return '实时行情';
  if (s === 'snapshot') return '快照价';
  return '示例价';
}
