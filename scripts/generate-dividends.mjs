// 生成 public/data/dividends.json：按 holdings.json 持仓 + 现金中的 SGOV，用 Yahoo 过去 12 个月实际派息估算年股息。
// 需要能访问 query1.finance.yahoo.com 的机器（Mac 当前访问不了，可在 box 上跑后拷回）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SGOV_SHARES = 255; // 用户 2026-10-05 告知：现金里 255 股 SGOV，当作现金，不进持仓
const holdings = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/holdings.json'), 'utf8'));
const list = (holdings.holdings || holdings.positions || []).map((h) => [h.ticker || h.symbol, Number(h.shares || h.qty || 0)]);
const ysym = (t) => t.replace('.', '-');
const r2 = (n) => Math.round(n * 100) / 100;

async function fetchDiv(t) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ysym(t)}?range=1y&interval=1d&events=div`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${t} HTTP ${res.status}`);
  const j = await res.json();
  const r = j.chart.result[0];
  const divs = Object.values(r.events?.dividends || {}).sort((a, b) => a.date - b.date);
  return { price: r.meta.regularMarketPrice, divs };
}

const stocks = []; const nonPayers = []; const missing = []; let mv = 0;
for (const [t, n] of list) {
  try {
    const { price, divs } = await fetchDiv(t);
    mv += n * price;
    const ttm = divs.reduce((a, d) => a + d.amount, 0);
    if (ttm > 0) stocks.push({ ticker: t, shares: n, price, ttm_per_share: Math.round(ttm * 1000) / 1000, annual: r2(n * ttm), yield_pct: r2(ttm / price * 100) });
    else nonPayers.push(t);
  } catch (e) { missing.push(t); console.warn('暂缺', t, e.message); }
  await new Promise((r) => setTimeout(r, 300));
}
stocks.sort((a, b) => b.annual - a.annual);

const g = await fetchDiv('SGOV');
const ttm = g.divs.reduce((a, d) => a + d.amount, 0);
const last = g.divs.at(-1);
const sgov = {
  ticker: 'SGOV', shares: SGOV_SHARES, price: g.price, ttm_per_share: Math.round(ttm * 1000) / 1000,
  annual: r2(SGOV_SHARES * ttm), yield_pct: r2(ttm / g.price * 100),
  last_div: last?.amount ?? null, last_div_date: last ? new Date(last.date * 1000).toISOString().slice(0, 10) : null,
  run_rate_annual: last ? r2(last.amount * 12 * SGOV_SHARES) : null,
  run_rate_yield_pct: last ? r2(last.amount * 12 / g.price * 100) : null,
  label: `现金中的 SGOV（${SGOV_SHARES} 股）`,
};
const stockSub = r2(stocks.reduce((a, s) => a + s.annual, 0));
const total = r2(stockSub + sgov.annual);
const out = {
  as_of: new Date().toISOString().slice(0, 10),
  source: 'Yahoo Finance 过去 12 个月实际派息（TTM）',
  note: '税前估算，按过去 12 个月实际派息，不含期权收入',
  stocks, non_payers: nonPayers, missing,
  stock_market_value: Math.round(mv), stock_subtotal: stockSub, stock_yield_pct: mv ? r2(stockSub / mv * 100) : 0,
  sgov, total_annual: total, monthly_avg: r2(total / 12),
};
fs.writeFileSync(path.join(ROOT, 'public/data/dividends.json'), JSON.stringify(out, null, 2) + '\n');
console.log('年股息', total, '月均', out.monthly_avg, '暂缺', missing);
