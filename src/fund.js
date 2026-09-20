import {
  DEMO_HOLDINGS,
  DEMO_OPTIONS,
  DEMO_CASH,
  DEMO_NOTES,
  FUND_CFG,
} from './data/demo.js';
import { fetchPrices, priceSourceLabel } from './lib/prices.js';
import { marketStatus } from './lib/market.js';
import {
  usd,
  usdSigned,
  pctSigned,
  moneyCls,
  escapeHTML,
  dayNumber,
  fmtExpiry,
} from './lib/format.js';

const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
const CFG = { ...FUND_CFG };

let holdings = DEMO_HOLDINGS.map((h) => ({ ...h }));
let options = DEMO_OPTIONS.map((o) => ({ ...o }));
let cashUSD = DEMO_CASH;
let notes = { ...DEMO_NOTES };
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
  if (r.costRet != null) {
    const c = r.costRet;
    spans.push(
      (c >= 0 ? '浮盈 ' : '浮亏 ') +
        '<b class="' +
        (c >= 0 ? 'nf-up' : 'nf-dn') +
        '">' +
        (c >= 0 ? '+' : '−') +
        Math.abs(c).toFixed(0) +
        '%</b>'
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

  const totalAssets = holdingsMV + (cashUSD != null ? cashUSD : 0);
  const cashW = cashUSD != null && totalAssets > 0 ? (cashUSD / totalAssets) * 100 : 0;
  const totalInvested = hasCost
    ? cumCost + (cashUSD != null ? cashUSD : 0)
    : cumPnL != 0
      ? totalAssets - cumPnL
      : null;
  const retPct = totalInvested > 0 ? (cumPnL / totalInvested) * 100 : null;
  const progress = totalAssets > 0 ? (totalAssets / CFG.goal) * 100 : null;

  const dayN = dayNumber(CFG.start);
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
  setMoney('d-cumpnl', hasCost ? cumPnL : null);
  document.getElementById('d-cumpnl-sub').textContent =
    totalInvested != null ? '本金 ' + usd(totalInvested) : '';
  setPct('d-ret', retPct);
  document.getElementById('d-ret-sub').textContent = retPct != null ? '相对本金' : '';
  setPlainPct('d-cash', cashUSD != null ? cashW : null);
  document.getElementById('d-cash-sub').textContent =
    cashUSD != null ? usd(cashUSD) + ' 现金' : '';

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
          '<td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>' +
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
        vcell +
        '<td class="note-cell">' +
        noteHTML +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  renderOptions();

  const vn = document.getElementById('vol-note');
  if (vn) {
    vn.textContent =
      'IV=隐含波动率' +
      (volData.date ? '（vol_data ' + volData.date + '）' : '') +
      ' · HV=30日历史波动率 · 绿=IV比HV高5点以上，权利金偏厚';
  }

  const src = priceSourceLabel(prices);
  document.getElementById('data-badge').textContent =
    src === 'live' ? 'Live quotes · 实时行情' : 'Demo data · 示例数据';
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

function renderOptions() {
  const panel = document.getElementById('opt-panel');
  const tb = document.getElementById('d-opt-rows');
  const sum = document.getElementById('opt-summary');
  if (!options.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const now = Date.now();
  const dteOf = (o) =>
    Math.ceil((new Date(o.expiry + 'T23:59:59').getTime() - now) / 86400000);
  const symPrem = {};
  options.forEach((o) => {
    symPrem[o.symbol] = (symPrem[o.symbol] || 0) + (o.premium || 0);
  });
  const sorted = options.slice().sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    return dteOf(a) - dteOf(b);
  });
  const symShown = {};
  let itm = 0;
  let nearest = null;
  const totalPrem = Object.values(symPrem).reduce((s, n) => s + n, 0);

  tb.innerHTML = sorted
    .map((o) => {
      const dte = dteOf(o);
      const isPut = /PUT/.test(o.type);
      const p = prices[o.symbol];
      const spot = p && !p.error && p.price != null ? p.price : null;
      let cush = null;
      let stCls = 'st-flat';
      let stTxt = '—';
      if (spot != null) {
        cush = isPut
          ? ((spot - o.strike) / o.strike) * 100
          : ((o.strike - spot) / spot) * 100;
        if (dte <= 0) {
          stTxt = '已到期';
          stCls = 'st-flat';
        } else if (cush < 0) {
          stTxt = '🔴 价内';
          stCls = 'st-dn';
          itm++;
        } else if (cush < 8) {
          stTxt = '🟡 垫薄';
          stCls = 'st-warn';
        } else {
          stTxt = '🟢 安全';
          stCls = 'st-up';
        }
      } else {
        stTxt = '行情缺失';
      }
      if (dte > 0 && (!nearest || dte < nearest.dte)) {
        nearest = { sym: o.symbol, dte, expiry: o.expiry };
      }
      const rounds = options.filter((x) => x.symbol === o.symbol).length;
      const first = !symShown[o.symbol];
      symShown[o.symbol] = true;
      const premCell = first
        ? '<td class="up" style="font-weight:700">+$' +
          symPrem[o.symbol].toLocaleString('en-US') +
          (rounds > 1
            ? ' <span class="opt-old">（含前收' + (rounds - 1) + '轮）</span>'
            : '') +
          '</td>'
        : '<td class="muted">+$' +
          (o.premium || 0).toLocaleString('en-US') +
          '（并入）</td>';
      const cushCell =
        cush == null
          ? '<td class="muted">—</td>'
          : '<td class="' +
            (cush >= 0 ? 'up' : 'down') +
            '" style="font-weight:700">' +
            (cush >= 0 ? '+' : '') +
            cush.toFixed(1) +
            '% ' +
            (cush >= 0 ? 'OTM' : 'ITM') +
            '</td>';
      const dteCell =
        dte <= 0
          ? '<td class="muted">已到期' + -dte + '天</td>'
          : '<td class="' +
            (dte <= 14 ? 'down' : dte <= 45 ? 'muted' : 'up') +
            '" style="font-weight:700">' +
            dte +
            '天</td>';
      return (
        '<tr>' +
        '<td class="l"><span class="sym">' +
        o.symbol +
        '</span></td>' +
        '<td class="l opt-contract">' +
        o.type.replace('SELL ', '卖').replace('BUY ', '买') +
        ' $' +
        o.strike +
        ' · ' +
        fmtExpiry(o.expiry) +
        '</td>' +
        dteCell +
        premCell +
        '<td>' +
        (spot != null ? '$' + spot.toFixed(2) : '—') +
        '</td>' +
        cushCell +
        '<td><span class="st ' +
        stCls +
        '">' +
        stTxt +
        '</span></td>' +
        '</tr>'
      );
    })
    .join('');

  let html =
    '总权利金 <b>+$' +
    totalPrem.toLocaleString('en-US') +
    '</b> · ' +
    Object.keys(symPrem).length +
    ' 标的 ' +
    options.length +
    ' 笔';
  html += itm > 0 ? ' · <span class="down">' + itm + ' 笔价内</span>' : ' · 全部价外 🟢';
  if (nearest) {
    html +=
      ' · 最近到期 ' +
      nearest.sym +
      ' ' +
      fmtExpiry(nearest.expiry) +
      '（' +
      nearest.dte +
      '天）';
  }
  sum.innerHTML = html;
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
  await loadVol();
  const syms = [
    ...new Set([
      ...holdings.map((h) => h.ticker),
      ...options.map((o) => o.symbol),
    ]),
  ];
  prices = await fetchPrices(syms, { hist: true });
  computeAndRender();
}

boot();
