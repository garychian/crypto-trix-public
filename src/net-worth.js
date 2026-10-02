/**
 * 总资产 / 我现在一共有多少钱 — US stocks (holdings + cash, USD) + A股基金 (CNY) combined.
 * Sources: holdings.json total_assets_usd (via loadHoldingsData), cn-fund.json total_wan,
 * FX = capital.json fx_usdcny. Each source may fail independently; show what is available.
 */
import { escapeHTML } from './lib/format.js';

const fmtUSD = (v) => '$' + Math.round(v).toLocaleString('en-US');
const fmtCNY = (v) => '¥' + Math.round(v).toLocaleString('en-US');
const mmdd = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)) : null);

async function loadCn() {
  try {
    const res = await fetch('/data/cn-fund.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    let wan = Number(j.total_wan);
    if (!Number.isFinite(wan) || wan <= 0) {
      wan = (j.holdings || []).reduce((s, h) => s + (Number(h.amount_wan) || 0), 0);
    }
    if (!(wan > 0)) return null;
    return { cny: wan * 10000, as_of: j.as_of || null };
  } catch {
    return null;
  }
}

function countUp(el, to, fmt) {
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !Number.isFinite(to)) {
    el.textContent = fmt(to);
    return;
  }
  const dur = 1100;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, Math.max(0, (performance.now() - t0) / dur));
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(step);
    else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}

export async function renderNetWorth(holdings) {
  const root = document.getElementById('net-worth');
  if (!root) return;
  const cn = await loadCn();
  const usUsd =
    holdings && holdings.source === 'live' && Number.isFinite(holdings.total_assets_usd)
      ? holdings.total_assets_usd
      : null;
  const fx = holdings && holdings.capital && holdings.capital.fx_usdcny > 0 ? holdings.capital.fx_usdcny : null;

  const head = `<div class="nw-head"><div class="en">Total Net Worth</div><h2 id="nw-title">总资产 · 我现在一共有多少钱</h2></div>`;

  if (usUsd == null && !cn) {
    root.innerHTML = head + '<p class="nw-note muted">数据暂时不可用，请稍后刷新。</p>';
    return;
  }

  const usDate = mmdd(holdings && holdings.as_of);
  const cnDate = mmdd(cn && cn.as_of);
  const notes = [];
  let bigHTML;
  let splitHTML = '';
  let totalUsd = null;

  if (usUsd != null && cn && fx) {
    const cnUsd = cn.cny / fx;
    totalUsd = usUsd + cnUsd;
    const usPct = (usUsd / totalUsd) * 100;
    const cnPct = 100 - usPct;
    bigHTML = `
      <div class="nw-big" id="nw-big" aria-live="off">${fmtUSD(totalUsd)}</div>
      <div class="nw-sub">≈ <span id="nw-cny">${fmtCNY(usUsd * fx + cn.cny)}</span></div>`;
    splitHTML = `
      <div class="nw-bar" role="img" aria-label="美股 ${usPct.toFixed(1)}%，A股基金 ${cnPct.toFixed(1)}%">
        <span class="nw-seg us" style="--w:${usPct.toFixed(2)}%"></span>
        <span class="nw-seg cn" style="--w:${cnPct.toFixed(2)}%"></span>
      </div>
      <div class="nw-chips">
        <a class="nw-chip" href="/fund.html">
          <i class="dot us"></i><span class="nw-chip-l">美股</span>
          <b>${fmtUSD(usUsd)}</b><em>${usPct.toFixed(1)}%</em>
        </a>
        <a class="nw-chip" href="/cn-fund.html">
          <i class="dot cn"></i><span class="nw-chip-l">A股基金</span>
          <b>${fmtCNY(cn.cny)}</b><em>${cnPct.toFixed(1)}%</em>
        </a>
      </div>`;
    notes.push(`汇率 ${fx.toFixed(2)}`);
    if (usDate) notes.push(`美股 ${usDate} 收盘`);
    if (cnDate) notes.push(`A股 ${cnDate} 配置快照`);
  } else {
    // Graceful degradation: show whichever side(s) we can, in their own currency.
    const only = usUsd != null ? 'us' : 'cn';
    if (usUsd != null) {
      bigHTML = `<div class="nw-big" id="nw-big">${fmtUSD(usUsd)}</div>` +
        (fx ? `<div class="nw-sub">≈ ${fmtCNY(usUsd * fx)}</div>` : '');
      notes.push(usDate ? `美股 ${usDate} 收盘` : '美股');
    } else {
      bigHTML = `<div class="nw-big" id="nw-big">${fmtCNY(cn.cny)}</div>` +
        (fx ? `<div class="nw-sub">≈ ${fmtUSD(cn.cny / fx)}</div>` : '');
      notes.push(cnDate ? `A股 ${cnDate} 配置快照` : 'A股基金');
    }
    totalUsd = only === 'us' ? usUsd : null;
    if (usUsd != null && !cn) notes.push('A股基金数据暂不可用，此处仅为美股');
    else if (usUsd == null) notes.push('美股数据暂不可用，此处仅为A股基金');
    else notes.push('汇率暂不可用，未合并折算');
    if (usUsd != null && cn && !fx) {
      splitHTML = `<div class="nw-chips">
        <a class="nw-chip" href="/fund.html"><i class="dot us"></i><span class="nw-chip-l">美股</span><b>${fmtUSD(usUsd)}</b></a>
        <a class="nw-chip" href="/cn-fund.html"><i class="dot cn"></i><span class="nw-chip-l">A股基金</span><b>${fmtCNY(cn.cny)}</b></a>
      </div>`;
    }
  }

  root.innerHTML = `
    ${head}
    <div class="nw-body">
      <div class="nw-main">${bigHTML}</div>
      <div class="nw-split">${splitHTML}</div>
    </div>
    <p class="nw-note muted">${escapeHTML(notes.join(' · '))} · #NFA</p>`;

  const big = document.getElementById('nw-big');
  if (big) {
    const txt = big.textContent;
    const isCny = txt.startsWith('¥');
    const target = totalUsd != null && !isCny ? totalUsd : cn && usUsd == null ? cn.cny : usUsd;
    countUp(big, target, isCny ? fmtCNY : fmtUSD);
  }
  const sub = document.getElementById('nw-cny');
  if (sub && usUsd != null && fx && cn) countUp(sub, usUsd * fx + cn.cny, fmtCNY);

  // grow the bar segments after paint
  requestAnimationFrame(() => root.classList.add('nw-ready'));
}
