import './nav.js';
import { DEMO_NOTES } from './data/demo.js';
import { loadHoldingsData, holdingsSourceBadge } from './lib/holdings.js';
import { fetchPrices, priceSourceLabel, priceSourceBadge, pricesFromHoldings } from './lib/prices.js';
import { marketStatus } from './lib/market.js';
import {
  usd,
  usdSigned,
  pctSigned,
  moneyCls,
  escapeHTML,
  dayNumber,
} from './lib/format.js';
import { initEquityChart } from './equity-chart.js';
import { renderAllocation } from './allocation-chart.js';
import { computeYtd, computePeriod, loadCheckins } from './lib/capital.js';


const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
const CFG = {
  start: '2026-07-16',
  goal: 2_000_000,
  handle: 'CRYPTOTRIX1',
  sub: 'US EQUITIES',
};

let holdings = [];
let options = [];
let cashUSD = null;
let notes = { ...DEMO_NOTES };
let snapshotDay = null;
let capital = null;
let checkins = null;
let snapshotTotal = null;
let holdingsMeta = null;
let prices = {};
let volData = { date: null, map: {} };

function msLabel(v) {
  return v >= 1e6 ? '$' + v / 1e6 + 'M' : '$' + v / 1e3 + 'K';
}

function setPlain(id, v) {
  const el = document.getElementById(id);
  if (v == null) {
    el.textContent = '—';
    el.className = 'value muted';
    return;
  }
  el.textContent = usd(v);
  el.className = 'value flat';
}

function setMoney(id, v) {
  const el = document.getElementById(id);
  if (v == null) {
    el.textContent = '—';
    el.className = 'value muted';
    return;
  }
  el.textContent = usdSigned(v);
  el.className = 'value ' + moneyCls(v);
}

function setPct(id, v) {
  const el = document.getElementById(id);
  if (v == null) {
    el.textContent = '—';
    el.className = 'value muted';
    return;
  }
  el.textContent = pctSigned(v);
  el.className = 'value ' + moneyCls(v);
}

function setPlainPct(id, v) {
  const el = document.getElementById(id);
  if (v == null) {
    el.textContent = '—';
    el.className = 'value muted';
    return;
  }
  el.textContent = v.toFixed(2) + '%';
  el.className = 'value flat';
}

function autoTag(cp) {
  if (cp == null) return { t: '', cls: 'tag-flat' };
  if (cp >= 3) return { t: '领涨', cls: 'tag-up' };
  if (cp >= 1) return { t: '走强', cls: 'tag-up' };
  if (cp <= -3) return { t: '重挫', cls: 'tag-down' };
  if (cp <= -1) return { t: '回吐', cls: 'tag-down' };
  return { t: '平稳', cls: 'tag-flat' };
}

function autoNoteHTML(r) {
  const spans = [];
  if (r.weight != null && r.weight >= 15) spans.push('<span class="nf-pos">第一重仓</span>');
  else if (r.weight != null && r.weight >= 8) spans.push('<span class="nf-pos">核心仓</span>');
  if (r.hasPrice && r.dailyD != null) {
    const d = Math.round(r.dailyD);
    spans.push(
      '当日 <b class="' +
        (d >= 0 ? 'nf-up' : 'nf-dn') +
        '">' +
        (d >= 0 ? '+' : '−') +
        '$' +
        Math.abs(d).toLocaleString('en-US') +
        '</b>'
    );
  }
  if (r.weight != null && r.weight <= 2) spans.push('<span class="nf-pos">观察仓</span>');
  return spans.length ? spans.join(' · ') : '—';
}

function renderMilestones(progress, total) {
  const ticksEl = document.getElementById('d-ticks');
  const labsEl = document.getElementById('d-labels');
  const reached = MILESTONES.filter((v) => total >= v);
  const next = MILESTONES.find((v) => total < v);
  let tHtml = '';
  let lHtml = '';
  MILESTONES.forEach((v) => {
    const pos = Math.min(100, (v / CFG.goal) * 100);
    const got = total >= v;
    const edge = pos >= 99 ? 'edge-r' : pos <= 3 ? 'edge-l' : '';
    tHtml +=
      '<div class="tick' + (got ? ' reached' : '') + '" style="left:' + pos + '%"></div>';
    lHtml +=
      '<span class="lab' +
      (got ? ' reached' : '') +
      ' ' +
      edge +
      '" style="left:' +
      pos +
      '%">' +
      (got ? '✓ ' : '') +
      msLabel(v) +
      '</span>';
  });
  ticksEl.innerHTML = tHtml;
  labsEl.innerHTML = lHtml;

  let st;
  if (!next) st = '🎉 全部里程碑达成 · 目标进度 ' + progress.toFixed(1) + '%';
  else if (reached.length) {
    const last = reached[reached.length - 1];
    st =
      '🏆 已过 ' +
      msLabel(last) +
      ' · 下一站 <b>' +
      msLabel(next) +
      '</b> · 还差 ' +
      usd(next - total);
  } else {
    st = '🚀 下一站 <b>' + msLabel(next) + '</b> · 还差 ' + usd(next - total);
  }
  document.getElementById('d-status').innerHTML = st;
}

function getP(h) {
  const p = prices[h.ticker];
  return p && !p.error && p.price != null ? p : null;
}

function trueShares(h) {
  return h.mv != null && h.price != null ? h.mv / h.price : h.shares;
}

function mvOf(h) {
  if (h.mv != null) {
    const p = getP(h);
    return p ? p.price * trueShares(h) : h.mv;
  }
  const p = getP(h);
  return p ? p.price * h.shares : null;
}

function periodRet(p, refKey) {
  if (!p || p[refKey] == null || !p.price) return null;
  return ((p.price - p[refKey]) / p[refKey]) * 100;
}

function periodCell(v) {
  if (v == null || !Number.isFinite(v)) return '<td class="muted">—</td>';
  return '<td class="' + moneyCls(v) + '" style="font-weight:700">' + pctSigned(v) + '</td>';
}

function costOf(h) {
  return h.costTotal != null ? h.costTotal : h.cost != null ? h.cost * h.shares : null;
}

function computeAndRender() {
  if (!holdings.length) return;

  let holdingsMV = 0;
  let dailyPnL = 0;
  let cumPnL = 0;
  let cumCost = 0;
  let hasCost = false;

  holdings.forEach((h) => {
    const mv = mvOf(h);
    if (mv == null) return;
    holdingsMV += mv;
    const p = getP(h);
    if (p) {
      const cp = p.changePct == null ? 0 : p.changePct;
      dailyPnL += (mv * cp) / (100 + cp);
    }
    const costRow = costOf(h);
    if (costRow != null) {
      cumPnL += mv - costRow;
      cumCost += costRow;
      hasCost = true;
    }
  });

  const srcLabel = priceSourceLabel(prices);
  const useSnapshotTotals =
    (srcLabel === 'snapshot' || srcLabel === 'demo') &&
    snapshotTotal != null;

  let totalAssets = holdingsMV + (cashUSD != null ? cashUSD : 0);
  // 持仓累计盈亏 = Σ(市值 − 成本) over current stock positions (no cash); 收益率 = pnl / Σ成本
  const displayCumPnL = hasCost ? cumPnL : null;
  const totalInvested = hasCost ? cumCost : null;

  if (useSnapshotTotals) totalAssets = snapshotTotal;

  const cashW = cashUSD != null && totalAssets > 0 ? (cashUSD / totalAssets) * 100 : 0;
  const retPct = totalInvested > 0 && displayCumPnL != null ? (displayCumPnL / totalInvested) * 100 : null;
  const progress = totalAssets > 0 ? (totalAssets / CFG.goal) * 100 : null;

  const dayN = snapshotDay != null ? snapshotDay : dayNumber(CFG.start);
  document.getElementById('d-day').textContent =
    dayN != null ? 'Day ' + dayN : 'Day —';
  document.getElementById('d-goal').textContent = usd(CFG.goal);
  document.getElementById('d-handle').textContent = CFG.handle;
  document.getElementById('d-sub').textContent = CFG.sub;

  if (progress != null) {
    document.getElementById('d-pct').textContent = progress.toFixed(2) + '%';
    document.getElementById('d-fill').style.width = Math.min(100, progress) + '%';
    document.getElementById('d-knob').style.left = Math.min(100, progress) + '%';
    document.getElementById('d-dist').innerHTML =
      '距目标 <b>' + usd(Math.max(0, CFG.goal - totalAssets)) + '</b>';
    renderMilestones(progress, totalAssets);
  }

  setPlain('d-total', totalAssets);
  document.getElementById('d-total-sub').textContent =
    cashUSD != null
      ? '持仓 ' + usd(holdingsMV) + ' · 现金 ' + usd(cashUSD)
      : '持仓市值';
  setMoney('d-daypnl', dailyPnL);
  document.getElementById('d-daypnl-sub').textContent = holdings.length + ' 只持仓';
  setMoney('d-cumpnl', displayCumPnL);
  document.getElementById('d-cumpnl-sub').textContent =
    totalInvested != null ? '当前持仓股票，不含现金 · 成本 ' + usd(totalInvested) : '';
  setPct('d-ret', retPct);
  document.getElementById('d-ret-sub').textContent = retPct != null ? '相对持仓成本' : '';
  setPlainPct('d-cash', cashUSD != null ? cashW : null);
  document.getElementById('d-cash-sub').textContent =
    cashUSD != null ? usd(cashUSD) + ' 现金' : '';

  renderAllocation(document.getElementById('alloc-chart'), {
    items: holdings
      .map((h) => ({ label: h.ticker, value: mvOf(h) }))
      .filter((x) => x.value != null),
    cash: cashUSD,
  });

  // Account-level returns (deposit-aware) — see lib/capital.js
  const setAcct = (id, subId, r, subText) => {
    const el = document.getElementById(id);
    if (!r) {
      el.textContent = '—';
      el.className = 'value muted';
      document.getElementById(subId).textContent = '数据未就绪';
      return;
    }
    el.className = 'value ' + moneyCls(r.pnl ?? r.profit);
    const money = r.pnl ?? r.profit;
    el.innerHTML =
      usdSigned(money) +
      (r.pct != null && Number.isFinite(r.pct) ? '<small>' + pctSigned(r.pct) + '</small>' : '');
    document.getElementById(subId).textContent = subText;
  };
  const ytd = computeYtd(totalAssets, capital);
  setAcct(
    'd-ytd',
    'd-ytd-sub',
    ytd,
    ytd
      ? '扣除入金，相对年初收益（含期权）'
      : ''
  );
  // WTD / MTD: completed check-ins + today's live move (live total − last synced snapshot total).
  // With only snapshot prices (live API down) totalAssets === snapshotTotal → live part is 0.
  const periodRef =
    prices && priceSourceLabel(prices) === 'live' && snapshotTotal != null
      ? { total: snapshotTotal, asOf: holdingsMeta && holdingsMeta.as_of }
      : null;
  const periodSub = (r, label) => {
    if (!r) return '';
    const base = label + ' ≈ ' + usd(r.startVal) + ' · ';
    if (r.mode === 'live') {
      return base + (r.n ? r.n + ' 日打卡 + ' : '') + '今日实时 ' + usdSigned(r.live) + '（含实时）';
    }
    if (r.mode === 'closed') return base + r.n + ' 个交易日 · 休市（含实时，增量 0）';
    return base + r.n + ' 个交易日 · 仅打卡数据';
  };
  const wtd = computePeriod(checkins, totalAssets, capital, 'week', periodRef);
  setAcct('d-wtd', 'd-wtd-sub', wtd, periodSub(wtd, '周初'));
  const mtd = computePeriod(checkins, totalAssets, capital, 'month', periodRef);
  setAcct('d-mtd', 'd-mtd-sub', mtd, periodSub(mtd, '月初'));

  const rows = holdings.map((h) => {
    const p = getP(h);
    const mv = mvOf(h);
    const costRow = costOf(h);
    const v = volData.map[h.ticker] || {};
    return {
      ticker: h.ticker,
      weight: h.weight,
      price: p ? p.price : null,
      cp: p ? p.changePct || 0 : null,
      hasPrice: !!p,
      iv: v.iv != null ? v.iv : null,
      ivr: v.ivr != null ? v.ivr : null,
      hv: p && p.hv30 != null ? p.hv30 : v.hv != null ? v.hv : null,
      dailyD:
        p && mv != null
          ? (mv * (p.changePct || 0)) / (100 + (p.changePct || 0))
          : null,
      costRet: mv != null && costRow != null ? (mv / costRow - 1) * 100 : null,
      wtd: periodRet(p, 'weeklyRef'),
      mtd: periodRet(p, 'monthlyRef'),
      ytd: periodRet(p, 'yearlyRef'),
    };
  });

  rows.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  document.getElementById('holdings-count').textContent = rows.length + ' 只';

  document.getElementById('d-rows').innerHTML = rows
    .map((r) => {
      const wBadge =
        r.weight != null
          ? '<span class="w-badge">' + r.weight.toFixed(1) + '%</span>'
          : '';
      if (!r.hasPrice) {
        return (
          '<tr>' +
          '<td class="l"><div class="t-tick"><span class="sym">' +
          r.ticker +
          '</span>' +
          wBadge +
          '</div></td>' +
          '<td class="muted">—</td>'.repeat(7) +
          '<td class="note-cell"><span class="tag tag-flat">加载中</span></td>' +
          '</tr>'
        );
      }
      const cls = r.cp > 0 ? 'up' : r.cp < 0 ? 'down' : 'muted';
      const note = notes[r.ticker];
      const tag = autoTag(r.cp);
      const body = note ? escapeHTML(note) : autoNoteHTML(r);
      const noteHTML = '<span class="tag ' + tag.cls + '">' + tag.t + '</span>' + body;
      const vcls =
        r.iv != null && r.hv != null
          ? r.iv - r.hv >= 5
            ? 'up'
            : r.iv - r.hv <= -5
              ? 'down'
              : 'muted'
          : 'muted';
      const vtip =
        'IV30 ' +
        (r.iv != null ? r.iv.toFixed(0) : '—') +
        '% · HV30 ' +
        (r.hv != null ? r.hv.toFixed(0) : '—') +
        '% · IVR ' +
        (r.ivr != null ? r.ivr : '—');
      const vcell =
        r.iv != null || r.hv != null
          ? '<td class="' +
            vcls +
            '" title="' +
            vtip +
            '">' +
            (r.iv != null ? r.iv.toFixed(0) : '—') +
            '/' +
            (r.hv != null ? r.hv.toFixed(0) : '—') +
            '</td>'
          : '<td class="muted">—</td>';
      return (
        '<tr>' +
        '<td class="l"><div class="t-tick"><span class="sym">' +
        r.ticker +
        '</span>' +
        wBadge +
        '</div></td>' +
        '<td>$' +
        r.price.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) +
        '</td>' +
        '<td class="' +
        cls +
        '" style="font-weight:700">' +
        pctSigned(r.cp) +
        '</td>' +
        periodCell(r.wtd) +
        periodCell(r.mtd) +
        periodCell(r.ytd) +
        periodCell(r.costRet) +
        vcell +
        '<td class="note-cell">' +
        noteHTML +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  const vn = document.getElementById('vol-note');
  if (vn) {
    vn.textContent =
      'IV=隐含波动率' +
      (volData.date ? '（vol_data ' + volData.date + '）' : '') +
      ' · HV=30日历史波动率 · 绿=IV比HV高5点以上，权利金偏厚';
  }

  const holdBadge = holdingsSourceBadge(holdingsMeta);
  const priceBadge = priceSourceBadge(prices);
  document.getElementById('data-badge').textContent =
    holdBadge + ' · ' + priceBadge;
  document.getElementById('lastupd').textContent =
    '更新于 ' +
    new Date().toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const m = marketStatus();
  document.getElementById('mkt').innerHTML =
    '<span class="dot ' +
    (m.open ? 'dot-open' : 'dot-closed') +
    '"></span>' +
    m.shortZh;
}

async function loadVol() {
  try {
    const r = await fetch('/vol_data.json?d=' + new Date().toISOString().slice(0, 10));
    if (!r.ok) return;
    const j = await r.json();
    const map = {};
    (j.holdings || []).forEach((h) => {
      if (h && h.sym) map[h.sym.toUpperCase()] = { iv: h.iv, hv: h.hv, ivr: h.ivr };
    });
    (j.puts || []).forEach((h) => {
      if (h && h.sym && !map[h.sym.toUpperCase()]) {
        map[h.sym.toUpperCase()] = { iv: h.iv, hv: h.hv, ivr: h.ivr };
      }
    });
    volData = { date: j.date || null, map };
  } catch {
    /* optional */
  }
}

async function boot() {
  const data = await loadHoldingsData();
  holdingsMeta = data;
  holdings = data.holdings;
  options = data.options;
  cashUSD = data.cash_usd;
  notes = data.notes || { ...DEMO_NOTES };
  snapshotDay = data.day;
  capital = data.capital;
  checkins = await loadCheckins();
  snapshotTotal = data.total_assets_usd;
  CFG.goal = data.goal_usd || CFG.goal;
  CFG.handle = data.handle || CFG.handle;
  CFG.sub = data.sub || CFG.sub;
  CFG.start = data.start || CFG.start;

  await loadVol();
  const syms = [...new Set(holdings.map((h) => h.ticker))];
  const snapshot = pricesFromHoldings(holdings, data.prices);
  prices = await fetchPrices(syms, { hist: true, snapshot });
  computeAndRender();
  await initEquityChart(document.getElementById('equity-chart'), {
    anchorTotal: snapshotTotal ?? data.total_assets_usd,
  });
}

boot();
