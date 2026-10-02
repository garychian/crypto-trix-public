import './nav.js';
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

function renderCategories(data) {
  const cats = data.categories || [];
  const bars = document.getElementById('cat-bars');
  const tiles = document.getElementById('cat-tiles');
  document.getElementById('cat-summary').textContent = cats.length + ' 类';

  bars.innerHTML = cats
    .map((c) => {
      const color = catColor(c.name);
      return `
        <div class="cat-bar-row">
          <div class="cat-bar-meta">
            <span class="cat-dot" style="background:${color}"></span>
            <span class="cat-name">${escapeHTML(c.name)}</span>
            <span class="cat-amt">${wan(c.amount_wan)} 万</span>
            <span class="cat-pct">${wan(c.weight_pct)}%</span>
          </div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="width:${Math.min(100, c.weight_pct)}%;background:${color}"></div>
          </div>
        </div>`;
    })
    .join('');

  tiles.innerHTML = cats
    .map((c) => {
      const color = catColor(c.name);
      return `
        <div class="cat-tile" style="border-color:${color}55;background:${color}18">
          <div class="ct-name">${escapeHTML(c.name)}</div>
          <div class="ct-pct" style="color:${color}">${wan(c.weight_pct)}%</div>
          <div class="ct-amt">${wan(c.amount_wan)} 万</div>
        </div>`;
    })
    .join('');
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
    renderCategories(data);
    renderHoldings(data);
  } catch (err) {
    console.error(err);
    document.getElementById('asof').textContent = '加载失败';
    document.getElementById('data-badge').textContent = '数据加载失败';
  }
}

boot();
