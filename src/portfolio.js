import { PORTFOLIO_HOLDINGS } from './data/demo.js';
import { fetchPrices, priceSourceLabel } from './lib/prices.js';
import { marketStatus } from './lib/market.js';
import { pctSigned, moneyCls } from './lib/format.js';

const holdings = PORTFOLIO_HOLDINGS.map((h) => ({ ...h }));
let prices = {};

function setVal(id, v, digits = 2) {
  const el = document.getElementById(id);
  if (v == null || !Number.isFinite(v)) {
    el.textContent = '—';
    el.className = 'value flat';
    return;
  }
  el.textContent = pctSigned(v, digits);
  el.className = 'value ' + moneyCls(v);
}

function tileSpan(weight) {
  if (weight >= 18) return 5;
  if (weight >= 12) return 4;
  if (weight >= 8) return 3;
  if (weight >= 4) return 2;
  return 1;
}

function colorFor(changePct, isCash) {
  if (isCash) return 'rgba(139,147,161,0.32)';
  if (changePct == null || Math.abs(changePct) < 0.05) return 'rgba(139,147,161,0.30)';
  const a = Math.min(0.92, 0.32 + Math.abs(changePct) * 0.14);
  return changePct >= 0
    ? 'rgba(14,203,129,' + a + ')'
    : 'rgba(246,70,93,' + a + ')';
}

function periodRet(p, refKey) {
  if (!p || p[refKey] == null || !p.price) return null;
  return ((p.price - p[refKey]) / p[refKey]) * 100;
}

function computeAndRender() {
  const live = holdings
    .map((h) => ({ h, p: prices[h.ticker] }))
    .filter(({ p }) => p && !p.error && p.price != null);

  if (!live.length) {
    document.getElementById('lastupd').textContent = 'No quotes';
    return;
  }

  let sumW = 0;
  let weighted = 0;
  let wNum = 0,
    wDen = 0,
    mNum = 0,
    mDen = 0,
    yNum = 0,
    yDen = 0;
  let stockCost = 0;
  let stockVal = 0;

  live.forEach(({ h, p }) => {
    const w = h.weight || 0;
    const cp = p.changePct || 0;
    sumW += w;
    weighted += cp * (w / 100);
    stockVal += p.price * h.shares;
    if (h.cost) stockCost += h.cost * h.shares;

    const wr = periodRet(p, 'weeklyRef');
    const mr = periodRet(p, 'monthlyRef');
    const yr = periodRet(p, 'yearlyRef');
    if (wr != null) {
      wNum += wr * w;
      wDen += w;
    }
    if (mr != null) {
      mNum += mr * w;
      mDen += w;
    }
    if (yr != null) {
      yNum += yr * w;
      yDen += w;
    }
  });

  const cashW = Math.max(0, 100 - sumW);
  document.getElementById('cashBadge').textContent =
    cashW > 0 ? '💵 Cash ' + cashW.toFixed(1) + '%' : '💵 Cash —';

  document.getElementById('c-count').textContent = String(holdings.length);
  setVal('c-today', weighted);
  setVal('c-week', wDen > 0 ? wNum / wDen : null);
  setVal('c-month', mDen > 0 ? mNum / mDen : null);
  setVal('c-year', yDen > 0 ? yNum / yDen : null);
  setVal('c-total', stockCost > 0 ? ((stockVal - stockCost) / stockCost) * 100 : null);

  const tiles = live
    .map(({ h, p }) => ({
      ticker: h.ticker,
      weight: h.weight || 0,
      changePct: p.changePct || 0,
      price: p.price,
      weekly: periodRet(p, 'weeklyRef'),
      monthly: periodRet(p, 'monthlyRef'),
      yearly: periodRet(p, 'yearlyRef'),
      costRet: h.cost ? ((p.price - h.cost) / h.cost) * 100 : null,
    }))
    .sort((a, b) => b.weight - a.weight);

  const grid = document.getElementById('weight-grid');
  let html = tiles
    .map((t) => {
      const span = tileSpan(t.weight);
      const chCls = moneyCls(t.changePct);
      return (
        '<div class="tile span-' +
        span +
        '" style="background:' +
        colorFor(t.changePct, false) +
        '">' +
        '<div class="t-sym">' +
        t.ticker +
        '</div>' +
        '<div><div class="t-w">' +
        t.weight.toFixed(1) +
        '%</div>' +
        '<div class="t-ch ' +
        chCls +
        '">' +
        pctSigned(t.changePct) +
        '</div></div>' +
        '</div>'
      );
    })
    .join('');

  if (cashW > 0) {
    html +=
      '<div class="tile span-2 cash"><div class="t-sym">💵 Cash</div><div class="t-w">' +
      cashW.toFixed(1) +
      '%</div></div>';
  }
  grid.innerHTML = html;

  document.getElementById('holdings-count').textContent = tiles.length + ' names';
  document.getElementById('d-rows').innerHTML = tiles
    .map((t) => {
      const cell = (v) =>
        '<td class="' +
        moneyCls(v) +
        '" style="font-weight:700">' +
        pctSigned(v) +
        '</td>';
      return (
        '<tr>' +
        '<td class="l"><span class="sym">' +
        t.ticker +
        '</span></td>' +
        '<td>' +
        t.weight.toFixed(1) +
        '%</td>' +
        '<td>$' +
        t.price.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) +
        '</td>' +
        cell(t.changePct) +
        cell(t.weekly) +
        cell(t.monthly) +
        cell(t.yearly) +
        cell(t.costRet) +
        '</tr>'
      );
    })
    .join('');

  const src = priceSourceLabel(prices);
  document.getElementById('data-badge').textContent =
    src === 'live' ? 'Live quotes' : 'Demo data';
  document.getElementById('lastupd').textContent =
    'Updated ' + new Date().toLocaleTimeString('en-US');

  const m = marketStatus();
  document.getElementById('mkt').innerHTML =
    '<span class="dot ' +
    (m.open ? 'dot-open' : 'dot-closed') +
    '"></span>' +
    m.shortEn;
}

async function boot() {
  const syms = holdings.map((h) => h.ticker);
  prices = await fetchPrices(syms, { hist: true });
  computeAndRender();
}

boot();
