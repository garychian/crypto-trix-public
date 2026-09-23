/**
 * Load canonical public holdings from /data/holdings.json.
 * Falls back to src/data/demo.js if the fetch fails.
 */
import {
  DEMO_HOLDINGS,
  DEMO_OPTIONS,
  DEMO_CASH,
  DEMO_NOTES,
  FUND_CFG,
} from '../data/demo.js';

function normalizeHolding(h) {
  const shares = Number(h.shares);
  const cost = h.cost != null ? Number(h.cost) : null;
  const costTotal =
    h.costTotal != null
      ? Number(h.costTotal)
      : cost != null && Number.isFinite(shares)
        ? Math.round(cost * shares * 100) / 100
        : null;
  const out = {
    ticker: String(h.ticker || h.symbol || '').toUpperCase(),
    shares,
    cost,
    costTotal,
  };
  if (h.weight != null && Number.isFinite(Number(h.weight))) out.weight = Number(h.weight);
  if (h.price != null) out.price = Number(h.price);
  if (h.mv != null) out.mv = Number(h.mv);
  return out;
}

function normalizeOption(o) {
  return {
    symbol: String(o.symbol || '').toUpperCase(),
    type: o.type || 'SELL PUT',
    strike: Number(o.strike),
    expiry: o.expiry,
    premium: Number(o.premium) || 0,
  };
}

function demoFallback() {
  return {
    as_of: '2026-09-20',
    day: 67,
    goal_usd: FUND_CFG.goal,
    cash_usd: DEMO_CASH,
    invested_usd: 93975,
    cum_pnl_usd: 47403,
    total_assets_usd: 141378,
    handle: FUND_CFG.handle,
    sub: FUND_CFG.sub,
    start: FUND_CFG.start,
    note: null,
    holdings: DEMO_HOLDINGS.map((h) => ({ ...h })),
    options: DEMO_OPTIONS.map((o) => ({ ...o })),
    notes: { ...DEMO_NOTES },
    prices: Object.fromEntries(
      DEMO_HOLDINGS.filter((h) => h.price != null).map((h) => [h.ticker, h.price])
    ),
    source: 'demo',
  };
}

/**
 * @returns {Promise<{
 *   as_of: string|null,
 *   day: number|null,
 *   goal_usd: number,
 *   cash_usd: number,
 *   invested_usd: number|null,
 *   cum_pnl_usd: number|null,
 *   total_assets_usd: number|null,
 *   annualized_return_pct: number|null,
 *   annual_return_target_pct: number|null,
 *   annual_return_year: number|null,
 *   handle: string,
 *   sub: string,
 *   start: string,
 *   holdings: object[],
 *   options: object[],
 *   notes: object,
 *   prices: Record<string, number>|null,
 *   source: 'live'|'demo'
 * }>}
 */
export async function loadHoldingsData() {
  try {
    const bust = new Date().toISOString().slice(0, 10);
    const res = await fetch(`/data/holdings.json?d=${bust}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (!Array.isArray(j.holdings) || !j.holdings.length) throw new Error('empty holdings');

    return {
      as_of: j.as_of || null,
      day: j.day != null ? Number(j.day) : null,
      goal_usd: Number(j.goal_usd) || FUND_CFG.goal,
      cash_usd: j.cash_usd != null ? Number(j.cash_usd) : DEMO_CASH,
      invested_usd: j.invested_usd != null ? Number(j.invested_usd) : null,
      cum_pnl_usd: j.cum_pnl_usd != null ? Number(j.cum_pnl_usd) : null,
      total_assets_usd: j.total_assets_usd != null ? Number(j.total_assets_usd) : null,
      annualized_return_pct:
        j.annualized_return_pct != null ? Number(j.annualized_return_pct) : null,
      annual_return_target_pct:
        j.annual_return_target_pct != null ? Number(j.annual_return_target_pct) : null,
      annual_return_year: j.annual_return_year != null ? Number(j.annual_return_year) : null,
      handle: (j.handle || FUND_CFG.handle).toUpperCase().replace(/^@/, ''),
      sub: j.sub || FUND_CFG.sub,
      start: j.start || FUND_CFG.start,
      note: j.note || null,
      holdings: j.holdings.map(normalizeHolding),
      options: Array.isArray(j.options) ? j.options.map(normalizeOption) : [],
      notes: j.notes && typeof j.notes === 'object' ? { ...j.notes } : { ...DEMO_NOTES },
      prices: j.prices && typeof j.prices === 'object' ? { ...j.prices } : null,
      source: 'live',
    };
  } catch {
    return demoFallback();
  }
}

/** Badge text for holdings source */
export function holdingsSourceBadge(data) {
  if (data?.source === 'live' && data.as_of) {
    return '仓库持仓 · ' + data.as_of;
  }
  if (data?.source === 'live') return '仓库持仓';
  return '示例持仓';
}
