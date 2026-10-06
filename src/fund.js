import './nav.js';
import { attachSnapshotButton } from './lib/snapshot.js';
import { renderDividendCard } from './dividends.js';
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
// Live ~15-min-delayed IV30 from /api/iv (CBOE). Per-ticker fallback: vol_data.json.
let liveIV = { map: {}, asOf: null, source: null };
// IVR needs ~1y of IV history (no free source) → only show vol_data.json IVR while fresh.
const IVR_MAX_AGE_DAYS = 14;
function volDataAgeDays() {
  if (!volData.date) return Infinity;
  const t = Date.parse(volData.date + 'T00:00:00Z');
  return Number.isFinite(t) ? (Date.now() - t) / 86400000 : Infinity;
}

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

// Valuation fundamentals (public/data/valuation.json, `npm run valuation`) × live price.
let valData = { asOf: null, map: {} };
async function loadValuation() {
  try {
    const r = await fetch('/data/valuation.json?d=' + new Date().toISOString().slice(0, 10));
    if (!r.ok) return;
    const j = await r.json();
    valData = { asOf: j.as_of || null, map: j.data || {} };
  } catch {
    /* optional */
  }
}
function valuationOf(ticker, price) {
  const v = valData.map[ticker];
  if (v && v.index) {
    // index-tracking ETF (QQQ→NDX, VOO→SPX): index valuation, scaled by the ETF's move since each figure's date
    const ix = v.index;
    const sc = (x, ref) => (x == null ? null : price != null && ref ? (x * price) / ref : x);
    const d = (iso) => (iso ? iso.slice(5).replace('-', '/') : '');
    const tip = ix.name + ' 指数估值';
    return {
      etf: true,
      index: ix.index,
      pe: sc(ix.pe, ix.pe_ref),
      fpe: sc(ix.fpe, ix.pe_ref),
      ps: sc(ix.ps, ix.ps_ref),
      mcap: sc(ix.mcap, ix.mcap_ref),
      tips: {
        pe: tip + '（WSJ/Birinyi 近12月，' + d(ix.pe_date) + '）',
        fpe: tip + '（WSJ/Birinyi 未来12月，' + d(ix.pe_date) + '）',
        ps: ix.ps != null ? tip + '（multpl，' + d(ix.ps_date) + '）' : ix.name + ' 无免费 P/S 数据',
        mcap: ix.name + ' 成分股总市值（slickcharts，' + d(ix.mcap_date) + '）',
      },
    };
  }
  if (!v || v.type === 'ETF') return { etf: !!v, pe: null, fpe: null, ps: null, mcap: null };
  const px = price != null ? price : v.price_ref;
  const mcap = v.mcap != null && v.price_ref && px ? (v.mcap * px) / v.price_ref : v.mcap ?? null;
  return {
    etf: false,
    pe: px && v.eps_ttm > 0 ? px / v.eps_ttm : null,
    fpe: px && v.eps_ntm > 0 ? px / v.eps_ntm : null,
    ps: mcap && v.rev_ttm > 0 ? mcap / v.rev_ttm : null,
    mcap,
    lossTTM: v.eps_ttm != null && v.eps_ttm <= 0,
  };
}
function compactUSD(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const u = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
  ].find(([d]) => Math.abs(n) >= d);
  if (!u) return '$' + Math.round(n).toLocaleString('en-US');
  const x = n / u[0];
  return '$' + (x >= 100 ? x.toFixed(0) : x.toFixed(x >= 10 ? 1 : 2)) + u[1];
}
function ratioCell(x, tip, idx) {
  const t = tip ? ' title="' + tip + '"' : '';
  if (x == null || !Number.isFinite(x)) return '<td class="muted"' + t + '>—</td>';
  return (
    '<td' + (idx ? ' class="idx-val"' : '') + t + '>' + (x >= 100 ? x.toFixed(0) : x.toFixed(1)) + '</td>'
  );
}

function periodCell(v) {
  if (v == null || !Number.isFinite(v)) return '<td class="muted">—</td>';
  return '<td class="' + moneyCls(v) + '" style="font-weight:700">' + pctSigned(v) + '</td>';
}

// 较成本: holdings cost is the broker's diluted cost (摊薄成本 — realised gains from trims are
// subtracted), so it can be tiny or negative (AMD after selling 2 of 10 shares → −61.30/股).
// A % return on such a base is meaningless → show — when cost ≤ 0 or the result exceeds +1000%.
const COST_RET_MAX = 1000;
function costRetOf(mv, costRow) {
  if (mv == null || costRow == null || !(costRow > 0)) return null;
  const r = (mv / costRow - 1) * 100;
  return Number.isFinite(r) && r >= -100 && r <= COST_RET_MAX ? r : null;
}
function costCell(r) {
  const per = r.costPer != null ? '成本 $' + r.costPer.toFixed(2) + '/股（券商摊薄成本）' : '无成本数据';
  if (r.costRet != null) {
    return '<td class="' + moneyCls(r.costRet) + '" style="font-weight:700" title="' + per + '">' + pctSigned(r.costRet) + '</td>';
  }
  const why = r.costPer == null ? per : per + '：成本≤0 或收益率超 +' + COST_RET_MAX + '%，百分比无意义';
  return '<td class="muted" title="' + why + '">—</td>';
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
  }, { maxNamed: Infinity, twoColFrom: 9 }); // every stock its own slice, no 其他

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
    const lv = liveIV.map[h.ticker];
    const ivrFresh = volDataAgeDays() <= IVR_MAX_AGE_DAYS;
    return {
      ticker: h.ticker,
      weight: h.weight,
      price: p ? p.price : null,
      cp: p ? p.changePct || 0 : null,
      hasPrice: !!p,
      iv: lv && lv.iv != null ? lv.iv : v.iv != null ? v.iv : null,
      ivLive: !!(lv && lv.iv != null),
      ivr: ivrFresh && v.ivr != null ? v.ivr : null,
      hv: p && p.hv30 != null ? p.hv30 : v.hv != null ? v.hv : null,
      dailyD:
        p && mv != null
          ? (mv * (p.changePct || 0)) / (100 + (p.changePct || 0))
          : null,
      costRet: costRetOf(mv, costRow),
      costPer: h.cost != null && Number.isFinite(Number(h.cost)) ? Number(h.cost) : null,
      wtd: periodRet(p, 'weeklyRef'),
      mtd: periodRet(p, 'monthlyRef'),
      ytd: periodRet(p, 'yearlyRef'),
      val: valuationOf(h.ticker, p ? p.price : null),
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
          '<td class="muted">—</td>'.repeat(11) +
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
        (r.iv != null ? r.iv.toFixed(1) : '—') +
        '%' +
        (r.iv != null ? (r.ivLive ? '（CBOE 延时）' : '（vol_data ' + (volData.date || '') + '）') : '') +
        ' · HV30 ' +
        (r.hv != null ? r.hv.toFixed(0) : '—') +
        '% · IVR ' +
        (r.ivr != null ? Math.round(r.ivr) + '（' + volData.date + '）' : '—');
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
        costCell(r) +
        vcell +
        (r.val.index
          ? ratioCell(r.val.pe, r.val.tips.pe, true) +
            ratioCell(r.val.fpe, r.val.tips.fpe, true) +
            ratioCell(r.val.ps, r.val.tips.ps, true) +
            (r.val.mcap != null
              ? '<td class="idx-val" title="' + r.val.tips.mcap + '"><span class="idx-tag">' + r.val.index + '</span>' +
                compactUSD(r.val.mcap) + '</td>'
              : '<td class="muted">—</td>')
          : ratioCell(r.val.pe, r.val.etf ? 'ETF 不显示' : r.val.lossTTM ? '近四季亏损' : '') +
            ratioCell(r.val.fpe, r.val.etf ? 'ETF 不显示' : '') +
            ratioCell(r.val.ps, r.val.etf ? 'ETF 不显示' : '') +
            (r.val.mcap != null
              ? '<td>' + compactUSD(r.val.mcap) + '</td>'
              : '<td class="muted"' + (r.val.etf ? ' title="ETF 不显示"' : '') + '>—</td>')) +
        '<td class="note-cell">' +
        noteHTML +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  const vn = document.getElementById('vol-note');
  if (vn) {
    const nLive = rows.filter((r) => r.ivLive).length;
    const ivPart =
      nLive > 0
        ? 'IV=30日隐含波动率（CBOE 延时约15分钟' +
          (nLive < rows.length ? '，缺失的用 vol_data ' + (volData.date || '') : '') +
          '）'
        : 'IV=隐含波动率（实时源暂不可用，用 vol_data ' + (volData.date || '—') + '）';
    const ivrPart =
      volDataAgeDays() <= IVR_MAX_AGE_DAYS
        ? 'IVR 见悬停（vol_data ' + volData.date + '）'
        : 'IVR 需一年 IV 历史，快照超 ' + IVR_MAX_AGE_DAYS + ' 天已隐藏';
    const first =
      ivPart + ' · HV=30日历史波动率（日收盘实算）· ' + ivrPart + ' · 绿=IV比HV高5点以上，权利金偏厚';
    const valLine = valData.asOf
      ? '估值：市盈率=现价/近四季GAAP摊薄EPS（SEC），远期PE=现价/未来四季一致预期EPS（Nasdaq/Zacks），市销率=市值/近四季营收；基本面 ' +
        valData.asOf +
        ' 更新，随实时价变动；QQQ/VOO 显示所跟踪指数（纳指100/标普500）估值：PE/远期PE 来自 WSJ·Birinyi，P/S 来自 multpl（仅标普500），市值=成分股总市值（slickcharts）；其他 ETF、亏损或无数据显示 —'
      : '';
    // keep the period-return explainer (2nd line) that ships in fund.html
    if (!vn.dataset.line2) {
      const parts = vn.innerHTML.split(/<br\s*\/?>/i);
      vn.dataset.line2 = parts.length > 1 ? parts.slice(1).join('<br>') : '';
    }
    vn.innerHTML =
      escapeHTML(first) +
      (vn.dataset.line2 ? '<br>' + vn.dataset.line2 : '') +
      (valLine ? '<br>' + escapeHTML(valLine) : '');
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

async function loadLiveIV(syms) {
  try {
    const r = await fetch('/api/iv?syms=' + encodeURIComponent(syms.join(',')));
    if (!r.ok) return;
    const j = await r.json();
    const map = {};
    Object.entries((j && j.data) || {}).forEach(([k, v]) => {
      if (v && typeof v.iv === 'number' && Number.isFinite(v.iv)) map[k.toUpperCase()] = v;
    });
    liveIV = { map, asOf: j.fetched_at || null, source: 'CBOE' };
  } catch {
    /* optional — falls back to vol_data.json */
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

  await Promise.all([loadVol(), loadValuation()]);
  const syms = [...new Set(holdings.map((h) => h.ticker))];
  const snapshot = pricesFromHoldings(holdings, data.prices);
  const ivP = loadLiveIV(syms);
  prices = await fetchPrices(syms, { hist: true, snapshot });
  await ivP;
  computeAndRender();
  await initEquityChart(document.getElementById('equity-chart'), {
    anchorTotal: snapshotTotal ?? data.total_assets_usd,
  });
}

[
  ['#stat-cards', 'fund-stats'],
  ['#equity-chart', 'nav-chart'],
  ['#alloc-chart', 'allocation'],
  ['.holdings-panel', 'holdings'],
  ['#dividend-card', 'dividends'],
].forEach(([sel, name]) => attachSnapshotButton(sel, name));

renderDividendCard(document.getElementById('dividend-card'));

// Sticky 标的 column + header row: edge shadows once scrolled; wrapper height for the frozen header.
(() => {
  const sc = document.getElementById('holdings-scroll');
  if (!sc) return;
  const upd = () => {
    sc.classList.toggle('is-scrolled', sc.scrollLeft > 2);
    sc.classList.toggle('is-scrolled-y', sc.scrollTop > 2);
  };
  sc.addEventListener('scroll', upd, { passive: true });
  upd();
  // frozen header: CSS caps the wrapper at 100svh − --nav-h. Nav height is re-measured via
  // ResizeObserver (in WebKit it reads ~3000px before CSS settles) and clamped to a sane range.
  const nav = document.querySelector('.top-nav');
  const setNavH = () => {
    const h = nav ? nav.getBoundingClientRect().height : 0;
    if (h >= 40 && h <= 160) document.documentElement.style.setProperty('--nav-h', Math.ceil(h) + 'px');
  };
  setNavH();
  window.addEventListener('resize', setNavH, { passive: true });
  window.addEventListener('load', setNavH);
  if (nav && 'ResizeObserver' in window) new ResizeObserver(setNavH).observe(nav);
})();

boot();
