import './nav.js';
import { attachSnapshotButton } from './lib/snapshot.js';
import { escapeHTML as esc } from './lib/format.js';
import { renderAllocation } from './allocation-chart.js';

const INITIAL_ROWS = 40;
const CHG = {
  new: { label: '新建', cls: 'c-new' },
  add: { label: '加仓', cls: 'c-add' },
  trim: { label: '减仓', cls: 'c-trim' },
  unchanged: { label: '持平', cls: 'c-flat' },
};

const state = { index: null, cache: new Map(), id: null, qi: 0, sort: { key: 'value', dir: -1 }, expanded: false };
const $ = (id) => document.getElementById(id);

/* ───────── formatting ───────── */
const fmtUsd = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1e8) {
    const x = v / 1e8;
    return '$' + (x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(x >= 10 ? 1 : 2)) + '亿';
  }
  if (v >= 1e4) return '$' + Math.round(v / 1e4).toLocaleString('en-US') + '万';
  return '$' + Math.round(v).toLocaleString('en-US');
};
const fmtSh = (v, type = 'SH') => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const unit = type === 'PRN' ? '' : '股';
  const sign = v < 0 ? '−' : '';
  if (a >= 1e8) return sign + (a / 1e8).toFixed(2) + '亿' + unit;
  if (a >= 1e4) return sign + (a / 1e4).toFixed(a >= 1e6 ? 0 : 1) + '万' + unit;
  return sign + Math.round(a).toLocaleString('en-US') + unit;
};
const qLabel = (period) => {
  const [y, m] = period.split('-').map(Number);
  return `Q${Math.ceil(m / 3)} ${y}`;
};
const pctTxt = (v, d = 2) => (v == null ? '—' : v.toFixed(d) + '%');

/* ───────── data ───────── */
async function loadInst(id) {
  if (state.cache.has(id)) return state.cache.get(id);
  const res = await fetch(`/data/13f/${id}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${id}.json ${res.status}`);
  const data = await res.json();
  state.cache.set(id, data);
  return data;
}

/* ───────── pills ───────── */
function badge(inst, size = '') {
  return `<span class="badge-ini${size}" style="--bc:${esc(inst.color)}">${esc(inst.initials)}</span>`;
}

function renderPills() {
  $('inst-pills').innerHTML = state.index.institutions
    .map((i) => {
      const on = i.id === state.id;
      const miss = i.status !== 'ok';
      return `<button type="button" class="ipill${on ? ' on' : ''}${miss ? ' miss' : ''}" role="tab" aria-selected="${on}" data-id="${esc(i.id)}" style="--bc:${esc(i.color)}">
        <i class="ipill-dot">${esc(i.initials.slice(0, 2))}</i><span>${esc(i.name_cn)}</span></button>`;
    })
    .join('');
  const on = $('inst-pills').querySelector('.on');
  if (on && on.scrollIntoView) {
    const box = $('inst-pills');
    if (box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, on.offsetLeft - 16);
  }
}

/* ───────── institution card ───────── */
function renderCard(meta, data) {
  const el = $('inst-card');
  if (meta.status !== 'ok' || !data) {
    el.innerHTML = `<div class="ic-top">${badge(meta, ' big')}<div class="ic-id"><h2>${esc(meta.name_cn)}</h2><div class="ic-sub">${esc(meta.name)} · ${esc(meta.manager)}</div></div></div>
      <p class="missing">数据暂缺：本次未能从 SEC EDGAR 拉取到该机构的 13F 数据${meta.error ? `（${esc(meta.error)}）` : ''}。</p>`;
    return;
  }
  const q = data.quarters[state.qi];
  const c = q.counts;
  const qBtns = data.quarters
    .map((x, i) => `<button type="button" class="qpill${i === state.qi ? ' on' : ''}" data-qi="${i}">${qLabel(x.period)}</button>`)
    .join('');
  const chg = c
    ? `<span class="c-new">新建 ${c.new}</span><span class="c-add">加仓 ${c.add}</span><span class="c-trim">减仓 ${c.trim}</span><span class="c-exit">清仓 ${c.exit}</span><span class="c-flat">持平 ${c.unchanged}</span>`
    : '<span class="muted">最早一期，无上季可比</span>';
  el.innerHTML = `
    <div class="ic-top">
      ${badge(data, ' big')}
      <div class="ic-id">
        <h2>${esc(data.name_cn)}${data.name.toLowerCase().startsWith(data.name_cn.toLowerCase()) ? '' : ` <small>${esc(data.name)}</small>`}</h2>
        <div class="ic-sub">掌门人 ${esc(data.manager)} · <a href="${esc(data.source_url)}" target="_blank" rel="noopener">SEC 申报 ↗</a> · CIK ${esc(data.cik)}</div>
      </div>
    </div>
    <div class="qrow" role="tablist" aria-label="季度">${qBtns}</div>
    <div class="ic-stats">
      <div><span>期末</span><b>${esc(q.period)}</b></div>
      <div><span>申报日</span><b>${esc(q.filing_date)}</b></div>
      <div><span>13F 市值</span><b>${fmtUsd(q.total_value_usd)}</b></div>
      <div><span>持仓</span><b>${q.n_positions} 只</b></div>
    </div>
    <div class="ic-chg"><span class="lbl">较${q.prev_period ? qLabel(q.prev_period) : '上季'}</span>${chg}</div>
    ${q.amendment ? `<p class="ic-note">${esc(q.amendment)}</p>` : ''}
    ${data.sec_entity && data.sec_entity.includes('+') ? `<p class="ic-note">申报主体：${esc(data.sec_entity)}（按季度合并；本季申报人：${esc(q.filer || '')}）</p>` : ''}`;
}

/* ───────── donut ───────── */
function renderDonut(data) {
  const el = $('alloc-chart');
  const q = data && data.quarters[state.qi];
  if (!q) {
    el.hidden = true;
    return;
  }
  const items = q.holdings.map((h) => ({ label: h.ticker || shortName(h.name), value: h.value, sub: h.cn || (h.ticker ? shortName(h.name) : '') }));
  if (q.other) items.push({ label: `其余 ${q.other.n} 只`, value: q.other.value, sub: '' });
  renderAllocation(
    el,
    { items, cash: null },
    {
      title: `持仓分布 · ${qLabel(q.period)}`,
      meta: () => `前 8 大 + 其他 · 共 ${q.n_positions} 只`,
      centerLabel: '13F 市值',
      centerSub: '美股多头',
      maxNamed: 8,
      twoColFrom: 9,
      fmtLegend: fmtUsd,
      fmtCenter: fmtUsd,
      fmtHover: fmtUsd,
    }
  );
}

const shortName = (n) => (n.length > 22 ? n.slice(0, 21) + '…' : n);

/* ───────── holdings table ───────── */
function chgSortVal(h) {
  const c = h.change;
  if (!c) return null;
  if (c.type === 'new') return 1e9;
  return c.d_pct;
}

function sortedHoldings(q) {
  const { key, dir } = state.sort;
  const rows = q.holdings.map((h, i) => ({ h, rank: i + 1 }));
  rows.sort((a, b) => {
    let av;
    let bv;
    if (key === 'ticker') { av = a.h.ticker || 'zzz' + a.h.name; bv = b.h.ticker || 'zzz' + b.h.name; return String(av).localeCompare(String(bv)) * dir; }
    if (key === 'name') return String(a.h.name).localeCompare(String(b.h.name)) * dir;
    if (key === 'chg') { av = chgSortVal(a.h); bv = chgSortVal(b.h); }
    else { av = a.h[key]; bv = b.h[key]; }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
  return rows;
}

function chgCell(h, hasPrev) {
  if (!hasPrev || !h.change) return '<span class="muted">—</span>';
  const c = h.change;
  const t = CHG[c.type];
  let d = '';
  if (c.type === 'new') d = `+${fmtSh(c.d_shares, h.sh_type)}`;
  else if (c.type !== 'unchanged') d = `${c.d_shares > 0 ? '+' : ''}${fmtSh(c.d_shares, h.sh_type)} <em>${c.d_pct > 0 ? '+' : ''}${c.d_pct.toFixed(1)}%</em>`;
  return `<span class="tagc ${t.cls}">${t.label}</span>${d ? `<span class="dsh ${c.d_shares > 0 ? 'up' : 'down'}">${d}</span>` : ''}`;
}

function renderTable(data) {
  const panel = $('hold-panel');
  const q = data && data.quarters[state.qi];
  if (!q) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const rows = sortedHoldings(q);
  const limit = state.expanded ? Infinity : INITIAL_ROWS;
  const hasPrev = !!q.counts;
  $('hold-body').innerHTML = rows
    .slice(0, limit)
    .map(({ h, rank }) => {
      const main = h.ticker || shortName(h.name);
      const sub = h.ticker ? h.cn || shortName(h.name) : h.cls || '';
      return `<tr>
        <td class="l c-rank"><span class="rk">${rank}</span></td>
        <td class="l c-sym"><div class="sy"><b>${esc(main)}</b></div><div class="sb">${esc(sub)}</div></td>
        <td class="l c-name" title="${esc(h.issuer)}">${esc(shortName(h.name))}${h.cn ? `<small>${esc(h.cn)}</small>` : ''}</td>
        <td class="c-sh">${fmtSh(h.shares, h.sh_type)}</td>
        <td class="c-val"><b>${fmtUsd(h.value)}</b></td>
        <td class="c-pct">${pctTxt(h.pct)}</td>
        <td class="c-chg">${chgCell(h, hasPrev)}</td>
      </tr>`;
    })
    .join('');
  $('hold-count').textContent = `${qLabel(q.period)} · 共 ${q.n_positions} 只${q.other ? `（展示前 ${q.holdings.length}，其余 ${q.other.n} 只合计 ${pctTxt(q.other.pct, 1)}）` : ''}`;
  const more = $('more-row');
  if (rows.length > limit) {
    more.hidden = false;
    $('more-btn').textContent = `展开全部 ${rows.length} 只`;
  } else if (state.expanded && rows.length > INITIAL_ROWS) {
    more.hidden = false;
    $('more-btn').textContent = '收起';
  } else more.hidden = true;
  for (const th of document.querySelectorAll('#hold-table th.sortable')) {
    const k = th.dataset.sort;
    const on = k === state.sort.key && !(th.classList.contains('c-rank') && state.sort.key !== 'value');
    th.classList.toggle('on', on && !th.classList.contains('c-rank'));
    const arr = th.querySelector('.arr');
    if (arr) arr.textContent = k === state.sort.key ? (state.sort.dir < 0 ? '▼' : '▲') : '';
  }
  $('hold-note').textContent = hasPrev
    ? `「较上季」= 与 ${qLabel(q.prev_period)} 比较的股数变化（±2% 内算持平）；#排名为本季市值排名，与排序无关。`
    : '该季是展示范围内最早一期，没有上一季可对比。';
}

/* ───────── exited / options ───────── */
function renderExited(data) {
  const el = $('exit-panel');
  const q = data && data.quarters[state.qi];
  if (!q || !q.exited) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (!q.exited.length) {
    el.innerHTML = `<div class="panel-head"><h2>清仓</h2><span class="muted">较 ${qLabel(q.prev_period)} 无清仓</span></div>`;
    return;
  }
  el.innerHTML = `<div class="panel-head"><h2>清仓</h2><span class="muted">较 ${qLabel(q.prev_period)} 不再持有 · 共 ${q.exited_n} 只${q.exited_n > q.exited.length ? `（列出前 ${q.exited.length}）` : ''}</span></div>
    <ul class="exit-list">${q.exited
      .map(
        (e) => `<li><span class="ex-sym">${esc(e.ticker || shortName(e.name))}</span><span class="ex-name">${esc(e.cn || (e.ticker ? shortName(e.name) : ''))}</span><span class="ex-val">上季 ${fmtUsd(e.prev_value)}</span></li>`
      )
      .join('')}</ul>`;
}

function renderOptions(data) {
  const el = $('opt-panel');
  const q = data && data.quarters[state.qi];
  if (!q || !q.options || !q.options.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `<div class="panel-head"><h2>期权（Put/Call）</h2><span class="muted">${q.options_n} 行 · 名义 ${fmtUsd(q.options_value_usd)} · 不计入持仓市值与占比</span></div>
    <ul class="exit-list">${q.options
      .slice(0, 12)
      .map(
        (o) => `<li><span class="ex-sym">${esc(o.ticker || shortName(o.name))}</span><span class="ex-name"><span class="pc ${o.put_call === 'Put' ? 'put' : 'call'}">${esc(o.put_call)}</span> ${esc(o.ticker ? '' : '')}</span><span class="ex-val">${fmtUsd(o.value)} · ${fmtSh(o.shares)}</span></li>`
      )
      .join('')}</ul>`;
}

/* ───────── orchestration ───────── */
async function show(id, qi = 0) {
  state.id = id;
  state.qi = qi;
  state.expanded = false;
  const meta = state.index.institutions.find((i) => i.id === id);
  renderPills();
  let data = null;
  if (meta && meta.status === 'ok') {
    try {
      data = await loadInst(id);
    } catch (e) {
      console.warn('13f load failed', e);
      meta.status = 'missing';
      meta.error = '文件加载失败';
    }
  }
  renderCard(meta, data);
  renderDonut(data);
  renderTable(data);
  renderExited(data);
  renderOptions(data);
  if (data) {
    $('src-note').textContent = `数据：SEC EDGAR 13F-HR 申报（CIK ${data.cik}），生成于 ${data.generated_at.slice(0, 10)}；ticker 由 SEC 公司列表按发行人名称映射，映射不到的显示英文名。`;
  }
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
}

function bind() {
  $('inst-pills').addEventListener('click', (e) => {
    const b = e.target.closest('.ipill');
    if (b) show(b.dataset.id);
  });
  $('inst-card').addEventListener('click', (e) => {
    const b = e.target.closest('.qpill');
    if (!b) return;
    state.qi = Number(b.dataset.qi);
    state.expanded = false;
    const data = state.cache.get(state.id);
    renderCard(state.index.institutions.find((i) => i.id === state.id), data);
    renderDonut(data);
    renderTable(data);
    renderExited(data);
    renderOptions(data);
  });
  document.querySelector('#hold-table thead').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    if (th.classList.contains('c-rank')) state.sort = { key: 'value', dir: -1 };
    else if (state.sort.key === key) state.sort.dir *= -1;
    else state.sort = { key, dir: key === 'ticker' || key === 'name' ? 1 : -1 };
    renderTable(state.cache.get(state.id));
  });
  $('more-btn').addEventListener('click', () => {
    state.expanded = !state.expanded;
    renderTable(state.cache.get(state.id));
  });
}

async function init() {
  bind();
  try {
    const res = await fetch('/data/13f/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('index.json ' + res.status);
    state.index = await res.json();
    const ok = state.index.institutions.filter((i) => i.status === 'ok');
    $('asof').textContent = `数据生成 ${state.index.generated_at.slice(0, 10)} · ${ok.length}/${state.index.institutions.length} 家机构`;
    $('d-sub').textContent = `${state.index.institutions.length} 家大机构 · 最近 6 个季度持仓与季度变化（SEC 13F-HR）`;
    const want = location.hash.slice(1);
    const first = state.index.institutions.find((i) => i.id === want) || state.index.institutions.find((i) => i.id === 'berkshire') || state.index.institutions[0];
    await show(first.id);
    ['#inst-card', '#alloc-chart', '#hold-panel', '#exit-panel', '#opt-panel'].forEach((sel, i) =>
      attachSnapshotButton(sel, ['13f-institution', '13f-allocation', '13f-holdings', '13f-exited', '13f-options'][i])
    );
  } catch (err) {
    console.warn('13f init failed', err);
    $('asof').textContent = '数据加载失败';
    $('inst-card').innerHTML = '<p class="missing">数据暂缺：13F 数据加载失败，请稍后刷新。</p>';
  }
}

init();
