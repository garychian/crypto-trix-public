import './nav.js';
import { attachSnapshotButton } from './lib/snapshot.js';
import { escapeHTML } from './lib/format.js';
import { renderAllocation } from './allocation-chart.js';

const CAT_COLORS = {
  固收: '#4C6FF7',
  A股: '#F0B90B',
  海外: '#0ECB81',
  港股: '#F6465D',
  商品: '#F5A623',
};

function wan(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function rmbFromWan(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const yuan = Math.round(v * 10000);
  return '¥' + yuan.toLocaleString('zh-CN');
}

function catColor(name) {
  return CAT_COLORS[name] || '#9AA4B2';
}

async function loadCnFund() {
  const res = await fetch('/data/cn-fund.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('cn-fund.json ' + res.status);
  return res.json();
}

function renderStats(data) {
  const holdings = data.holdings || [];
  const total = data.total_wan ?? holdings.reduce((s, h) => s + (h.amount_wan || 0), 0);
  const max = holdings.slice().sort((a, b) => (b.amount_wan || 0) - (a.amount_wan || 0))[0];
  const cats = data.categories || [];

  document.getElementById('d-total').textContent = wan(total) + ' 万';
  document.getElementById('d-total-sub').textContent = '约合 ' + rmbFromWan(total);
  document.getElementById('d-count').textContent = String(holdings.length);
  document.getElementById('d-count-sub').textContent = '只持仓';
  document.getElementById('d-max').textContent = max ? max.name : '—';
  document.getElementById('d-max-sub').textContent = max
    ? wan(max.amount_wan) + ' 万 · ' + wan(max.weight_pct) + '%'
    : '';
  document.getElementById('d-cats').textContent = String(cats.length || '—');
  document.getElementById('d-cats-sub').textContent = cats.map((c) => c.name).join(' / ');
}


function renderHoldings(data) {
  const holdings = (data.holdings || []).filter((h) => Number.isFinite(h.amount_wan) && h.amount_wan > 0);
  // Slice values are amount_wan, so they sum to total_wan and reconcile with the 总资产 card.
  renderAllocation(
    document.getElementById('alloc-chart'),
    {
      items: holdings.map((h) => ({ label: h.name, value: h.amount_wan, sub: h.category || '' })),
      cash: null,
    },
    {
      title: '持仓明细',
      meta: (n) => n + ' 只 · 万元',
      centerLabel: '总资产',
      centerSub: '人民币配置',
      maxNamed: 9, // 9 funds today: list every one; only group into 其他 beyond 10
      fmtLegend: (v) => wan(v) + ' 万',
      fmtCenter: (v) => rmbFromWan(v),
      fmtHover: (v) => rmbFromWan(v),
    }
  );
}


function yuan(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return '¥' + Math.round(v).toLocaleString('zh-CN');
}

function renderIncome(data) {
  const el = document.getElementById('cn-income-card');
  if (!el) return;
  const inc = data.income;
  if (!inc || !Array.isArray(inc.items) || !inc.items.length) {
    el.hidden = true;
    return;
  }
  const rows = inc.items
    .map(
      (it) => `
    <tr>
      <td class="l">${escapeHTML(it.name)}${it.source && it.source !== it.name ? ` <span class="muted">（${escapeHTML(it.source)}）</span>` : ''}</td>
      <td>${wan(it.amount_wan)} 万</td>
      <td>${wan(it.yield_pct, 1)}%</td>
      <td class="up">${yuan(it.annual_yuan)}</td>
    </tr>`
    )
    .join('');
  el.hidden = false;
  el.innerHTML = `
    <div class="panel-head"><h2>分红 / 固收收入</h2><span class="muted">年化估算 · ${escapeHTML(data.as_of || '')}</span></div>
    <div class="div-hero">
      <div><div class="div-label">预计年收入</div><div class="div-big">${yuan(inc.total_annual_yuan)}</div></div>
      <div><div class="div-label">月均</div><div class="div-mid">${yuan(inc.monthly_avg_yuan)}</div></div>
      <div><div class="div-label">相对总资产</div><div class="div-mid">${wan(inc.portfolio_yield_pct)}%</div><div class="div-sub">固收 3.5% · 红利低波 5%</div></div>
    </div>
    <div class="table-scroll">
      <table class="data div-table">
        <thead><tr><th class="l">来源</th><th>金额</th><th>年化</th><th>年收入</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="vol-note">${escapeHTML(inc.note || '')}</p>`;
}

async function boot() {
  try {
    const data = await loadCnFund();
    if (data.subtitle) document.getElementById('d-sub').textContent = data.subtitle;
    document.getElementById('asof').textContent =
      'as of ' + (data.as_of || '—') + ' · Asia/Shanghai';
    document.getElementById('data-badge').textContent =
      '配置快照 · ' + (data.as_of || 'cn-fund.json');
    if (data.note) document.getElementById('data-note').textContent = data.note;

    renderStats(data);
    renderHoldings(data);
    renderIncome(data);
  } catch (err) {
    console.error(err);
    document.getElementById('asof').textContent = '加载失败';
    document.getElementById('data-badge').textContent = '数据加载失败';
  }
}

[
  ['#stat-cards', 'cn-fund-overview'],
  ['#alloc-chart', 'cn-fund-allocation'],
  ['#cn-income-card', 'cn-fund-income'],
].forEach(([sel, name]) => attachSnapshotButton(sel, name));

boot();
