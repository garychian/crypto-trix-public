import './nav.js';
import { attachSnapshotButton } from './lib/snapshot.js';
import { escapeHTML } from './lib/format.js';

const CATS = ['贵金属', '加密', '股票', '债券与现金类', '房地产', '代币化RWA'];
const CAT_COLORS = {
  贵金属: '#E3B341',
  加密: '#F7931A',
  股票: '#4C6FF7',
  债券与现金类: '#0ECB81',
  房地产: '#B07CFF',
  代币化RWA: '#2EC4D6',
};
const KIND_LABEL = { live: '实时', derived: '估算', static: '静态约值' };
const INITIAL_ROWS = 30;
const LIVE_URL = '/api/assets-live';

const state = {
  data: null,
  baselineAsOf: null,
  liveMeta: null, // { live, degraded, as_of, hits }
  cat: '全部',
  q: '',
  hideClasses: false,
  sort: { key: 'mcap_usd', dir: -1 },
  unit: 'cn',
  expanded: false,
  open: null,
};
try {
  const u = localStorage.getItem('ct-assets-unit');
  if (u === 'cn' || u === 'en') state.unit = u;
} catch { /* private mode */ }

const $ = (id) => document.getElementById(id);

/* ───────── formatting ───────── */
function fmtMcap(v, unit = state.unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (unit === 'cn') {
    if (v >= 1e12) {
      const x = v / 1e12;
      return '$' + x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2) + '万亿';
    }
    if (v >= 1e8) {
      const x = v / 1e8;
      return '$' + (x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1)) + '亿';
    }
    return '$' + (v / 1e4).toFixed(0) + '万';
  }
  if (v >= 1e12) {
    const x = v / 1e12;
    return '$' + x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2) + 'T';
  }
  if (v >= 1e9) {
    const x = v / 1e9;
    return '$' + (x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1)) + 'B';
  }
  return '$' + (v / 1e6).toFixed(0) + 'M';
}

function pct(v) {
  if (v == null || !Number.isFinite(v)) return '<span class="muted">—</span>';
  const cls = v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'flat';
  const sign = v > 0.005 ? '+' : v < -0.005 ? '−' : '';
  const a = Math.abs(v);
  return `<span class="${cls}">${sign}${a.toFixed(a >= 1000 ? 0 : a >= 100 ? 1 : 2)}%</span>`;
}

function spark(arr, up) {
  if (!arr || arr.length < 3) return '<span class="muted">—</span>';
  const w = 84;
  const h = 26;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const rng = max - min || 1;
  const pts = arr
    .map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / rng) * (h - 4)).toFixed(1)}`)
    .join(' ');
  const col = up ? '#0ECB81' : '#F6465D';
  return `<svg class="spk" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function dateShort(s) {
  return s ? String(s).slice(0, 10) : '';
}

/* ───────── live merge ───────── */
function scaleDerivedMcap(item, newPrice) {
  const oldP = item.price;
  if (!(Number.isFinite(oldP) && oldP > 0 && Number.isFinite(newPrice) && newPrice > 0)) return null;
  if (!(Number.isFinite(item.mcap_usd) && item.mcap_usd > 0)) return null;
  return Math.round(item.mcap_usd * (newPrice / oldP));
}

/** Overlay /api/assets-live updates onto the static baseline. Never invents values. */
function mergeLive(data, live) {
  if (!data?.items || !live?.updates) return { merged: 0, stock: 0, crypto: 0 };
  let merged = 0;
  let stock = 0;
  let crypto = 0;
  for (const item of data.items) {
    const u = live.updates[item.id];
    if (!u) continue;
    let touched = false;
    if (Number.isFinite(u.mcap_usd) && u.mcap_usd > 0) {
      item.mcap_usd = u.mcap_usd;
      touched = true;
    } else if ((item.kind === 'derived' || item.id === 'gold' || item.id === 'silver') && Number.isFinite(u.price)) {
      const scaled = scaleDerivedMcap(item, u.price);
      if (scaled != null) {
        item.mcap_usd = scaled;
        touched = true;
      }
    }
    if (Number.isFinite(u.price) && u.price > 0) {
      item.price = u.price;
      touched = true;
    }
    if (u.chg_24h != null && Number.isFinite(u.chg_24h)) {
      item.chg_24h = u.chg_24h;
      touched = true;
    }
    if (u.chg_1y != null && Number.isFinite(u.chg_1y)) {
      item.chg_1y = u.chg_1y;
      touched = true;
    }
    if (Array.isArray(u.spark) && u.spark.length >= 3) {
      item.spark = u.spark;
      touched = true;
    }
    if (!touched) continue;
    if (u.data_date) item.data_date = u.data_date;
    if (u.source) item.source = u.source;
    item.live_refresh = true;
    item.stale = false;
    if (item.kind === 'static') {
      /* keep static kind for class totals */
    } else if (item.kind !== 'derived') {
      item.kind = 'live';
      item.approx = false;
    }
    merged++;
    if (item.id.startsWith('co-')) stock++;
    if (item.category === '加密' || item.category === '代币化RWA') crypto++;
  }
  if (live.crypto_total?.mcap_usd) {
    data.crypto_total = live.crypto_total;
  }
  data.items.sort((a, b) => b.mcap_usd - a.mcap_usd);
  data.live_as_of = live.as_of || null;
  data.live_generated_at = live.generated_at || null;
  return { merged, stock, crypto };
}

function setDataBadge(liveMeta, baselineAsOf) {
  const el = $('data-badge');
  if (!el) return;
  el.classList.remove('badge-live', 'badge-delayed');
  if (liveMeta?.live && !liveMeta.degraded) {
    el.classList.add('badge-live');
    const n = liveMeta.hits?.cmc || liveMeta.mergedStock || '';
    el.textContent = n ? `LIVE · 股票市值` : 'LIVE';
    el.title = `边缘缓存约 10 分钟 · CMC ${liveMeta.hits?.cmc ?? 0} · Yahoo ${liveMeta.hits?.yahoo ?? 0} · CG ${liveMeta.hits?.coingecko ?? 0}`;
  } else if (liveMeta?.live) {
    el.classList.add('badge-live');
    el.textContent = 'LIVE · 部分';
    el.title = '部分源成功；其余沿用静态基线';
  } else {
    el.classList.add('badge-delayed');
    el.textContent = '延迟 · 静态基线';
    el.title = baselineAsOf ? `基线 as_of ${baselineAsOf}` : '实时源不可用，显示静态 assets.json';
  }
}

/* ───────── cards ───────── */
function setCard(id, value, sub) {
  $(id).textContent = value;
  $(id + '-sub').innerHTML = sub || '';
}

function pickRwaSyms(rwa) {
  const pref = ['BUIDL', 'USDY', 'PAXG', 'XAUT'];
  const have = rwa.map((i) => i.symbol);
  const syms = pref.filter((s) => have.includes(s));
  return (syms.length ? syms : have.slice(0, 3)).join(' / ');
}

function renderCards(data) {
  const items = data.items;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const gold = byId.gold;
  const btc = byId.bitcoin;
  if (gold) {
    const times = btc ? ` · 约为比特币的 ${(gold.mcap_usd / btc.mcap_usd).toFixed(1)} 倍` : '';
    setCard('c-gold', fmtMcap(gold.mcap_usd), `24h ${pct(gold.chg_24h)}${times}`);
  }
  const ct = data.crypto_total;
  if (ct) {
    setCard('c-crypto', fmtMcap(ct.mcap_usd), `24h ${pct(ct.chg_24h)} · BTC 占比 ${ct.btc_dominance?.toFixed(1) ?? '—'}%`);
  } else if (btc) {
    setCard('c-crypto', fmtMcap(items.filter((i) => i.category === '加密').reduce((s, i) => s + i.mcap_usd, 0)), '收录加密合计');
  }
  const cos = items.filter((i) => i.category === '股票' && i.type === 'asset').sort((a, b) => b.mcap_usd - a.mcap_usd);
  if (cos[0]) setCard('c-co', cos[0].name, `${fmtMcap(cos[0].mcap_usd)} · 24h ${pct(cos[0].chg_24h)}`);
  const rwa = items.filter((i) => i.category === '代币化RWA');
  if (rwa.length) {
    const sum = rwa.reduce((s, i) => s + i.mcap_usd, 0);
    setCard('c-rwa', fmtMcap(sum), `${rwa.length} 个代币 · 含 ${pickRwaSyms(rwa)}`);
  }
}

/* ───────── table ───────── */
function visibleItems() {
  const all = state.data.items.filter((i) => !(state.hideClasses && i.type === 'class'));
  // fixed rank by market cap within the (type-filtered) universe
  const ranked = all.slice().sort((a, b) => b.mcap_usd - a.mcap_usd);
  ranked.forEach((it, idx) => (it._rank = idx + 1));
  const q = state.q.trim().toLowerCase();
  let rows = ranked.filter((i) => {
    // 总量类参考（全球股市/债券/房地产）只出现在「全部」，类别 pill 只列个体资产
    if (state.cat !== '全部' && (i.type === 'class' || i.category !== state.cat)) return false;
    if (!q) return true;
    return [i.name, i.name_en, i.symbol, i.category, i.rwa_type].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  const { key, dir } = state.sort;
  rows = rows.slice().sort((a, b) => {
    if (key === 'name' || key === 'category') return String(a[key]).localeCompare(String(b[key]), 'zh') * dir;
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // blanks always last
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
  return { rows, all: ranked };
}

function rowHtml(i) {
  const col = CAT_COLORS[i.category] || '#9AA4B2';
  const est = i.approx || i.kind === 'static' || i.kind === 'derived';
  const estTag = est ? `<span class="est" title="${escapeHTML(i.source)}">${i.kind === 'static' ? '约' : '估'}</span>` : '';
  const liveTag = i.live_refresh && !est ? `<span class="live-tag" title="已合并实时源">LIVE</span>` : '';
  const typeTag = i.type === 'class' ? '<span class="cls">大类</span>' : '';
  const sub = [i.symbol, i.rwa_type].filter(Boolean).join(' · ');
  const up1y = (i.chg_1y ?? 0) >= 0;
  const open = state.open === i.id;
  return `<tr class="arow${open ? ' open' : ''}" data-id="${escapeHTML(i.id)}" tabindex="0" aria-expanded="${open}">
    <td class="l c-rank"><span class="rk">${i._rank}</span></td>
    <td class="l c-name"><div class="nm"><b>${escapeHTML(i.name)}</b>${typeTag}</div><div class="sb">${escapeHTML(sub)}<span class="m-cat"> · ${escapeHTML(i.category)}</span></div></td>
    <td class="l c-cat"><span class="cat-dot" style="background:${col}"></span>${escapeHTML(i.category)}</td>
    <td class="c-mc"><span class="mc">${fmtMcap(i.mcap_usd)}</span>${estTag}${liveTag}</td>
    <td class="c-24">${pct(i.chg_24h)}</td>
    <td class="c-1y">${pct(i.chg_1y)}</td>
    <td class="c-spark">${spark(i.spark, up1y)}</td>
  </tr>${open ? detailHtml(i) : ''}`;
}

function detailHtml(i) {
  const kind = KIND_LABEL[i.kind] || i.kind;
  const link = i.source_url ? `<a href="${escapeHTML(i.source_url)}" target="_blank" rel="noopener">来源链接 ↗</a>` : '';
  const bits = [
    `<span class="k k-${i.kind}">${kind}</span>`,
    `数据日期 ${escapeHTML(dateShort(i.data_date))}`,
    i.stock_date ? `存量口径 ${escapeHTML(dateShort(i.stock_date))}` : '',
    i.live_refresh ? '<span class="k k-live">LIVE</span>' : '',
    i.stale ? '<span class="k k-static">上次抓取值</span>' : '',
  ].filter(Boolean);
  return `<tr class="adetail"><td colspan="7"><div class="dt-in">
    <div class="dt-meta">${bits.join(' · ')}</div>
    <div class="dt-src">${escapeHTML(i.source)}</div>
    ${i.note ? `<div class="dt-note">${escapeHTML(i.note)}</div>` : ''}
    <div class="dt-link">${link}</div>
  </div></td></tr>`;
}

function renderPills(all) {
  const counts = { 全部: all.length };
  for (const c of CATS) counts[c] = all.filter((i) => i.type !== 'class' && i.category === c).length;
  const mk = (name) =>
    `<button type="button" class="pill${state.cat === name ? ' on' : ''}" role="tab" aria-selected="${state.cat === name}" data-cat="${name}">${
      name === '全部' ? '' : `<i style="background:${CAT_COLORS[name]}"></i>`
    }${name}<em>${counts[name] ?? 0}</em></button>`;
  $('pills').innerHTML =
    ['全部', ...CATS].map(mk).join('') +
    `<button type="button" class="pill toggle${state.hideClasses ? ' on' : ''}" id="pill-hide" aria-pressed="${state.hideClasses}">仅单一资产</button>`;
}

function renderTable() {
  const { rows, all } = visibleItems();
  renderPills(all);
  const limit = state.cat === '全部' && !state.q.trim() && !state.expanded ? INITIAL_ROWS : Infinity;
  const shown = rows.slice(0, limit);
  $('assets-body').innerHTML = shown.length
    ? shown.map(rowHtml).join('')
    : '<tr><td colspan="7" class="empty">没有匹配的资产</td></tr>';
  $('assets-count').textContent = `共 ${rows.length} 项 · 按${state.sort.key === 'mcap_usd' ? '市值' : '所选列'}${state.sort.dir < 0 ? '降序' : '升序'}`;
  const more = $('more-row');
  if (rows.length > shown.length) {
    more.hidden = false;
    $('more-btn').textContent = `展开全部 ${rows.length} 项`;
  } else if (state.expanded && state.cat === '全部' && rows.length > INITIAL_ROWS) {
    more.hidden = false;
    $('more-btn').textContent = '收起';
  } else {
    more.hidden = true;
  }
  for (const th of document.querySelectorAll('#assets-table th.sortable')) {
    const on = th.dataset.sort === state.sort.key;
    th.classList.toggle('on', on);
    const arr = th.querySelector('.arr');
    if (arr) arr.textContent = on ? (state.sort.dir < 0 ? '▼' : '▲') : '';
    th.setAttribute('aria-sort', on ? (state.sort.dir < 0 ? 'descending' : 'ascending') : 'none');
  }
}

function renderMeta(data) {
  const liveGen = data.live_generated_at ? new Date(data.live_generated_at) : null;
  const baseGen = data.generated_at ? new Date(data.generated_at) : null;
  const gen = liveGen || baseGen;
  const hhmm = gen
    ? gen.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' (北京时间)'
    : '';
  const asOf = data.live_as_of || data.as_of;
  const baseNote = state.baselineAsOf && data.live_as_of && data.live_as_of !== state.baselineAsOf
    ? ` · 基线 ${state.baselineAsOf}`
    : '';
  $('asof').textContent = `数据日期 ${asOf}${hhmm ? ' · 更新 ' + hhmm : ''}${baseNote}`;
  $('assets-note').innerHTML =
    '「约」= 公开报告的近似静态值，「估」= 实时价格 × 公开存量估算；标 LIVE 的股票/加密为页面加载后从公开接口刷新（边缘缓存约 10 分钟）。点击任意一行查看来源与数据日期。' +
    '股票 / 商品的 24h 为最近一个交易日涨跌，1年为近一年涨跌（价格口径，非市值口径）。大类（债券、房地产等）市值与单一资产口径不同，仅作量级参考。实时源失败时回退静态基线并标延迟。#NFA';
  $('src-list').innerHTML = (data.sources || [])
    .map(
      (s) =>
        `<li><span class="k k-${s.kind === 'live' ? 'live' : 'static'}">${s.kind === 'live' ? '实时' : '静态约值'}</span> <a href="${escapeHTML(s.url)}" target="_blank" rel="noopener">${escapeHTML(s.name)}</a> <span class="muted">· ${escapeHTML(s.use)}</span></li>`
    )
    .join('');
}

function bind() {
  $('pills').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'pill-hide') state.hideClasses = !state.hideClasses;
    else if (b.dataset.cat) {
      state.cat = b.dataset.cat;
      state.expanded = false;
    }
    state.open = null;
    renderTable();
  });
  $('q').addEventListener('input', (e) => {
    state.q = e.target.value;
    state.open = null;
    renderTable();
  });
  $('unit-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-unit]');
    if (!b) return;
    state.unit = b.dataset.unit;
    try { localStorage.setItem('ct-assets-unit', state.unit); } catch { /* ignore */ }
    syncUnit();
    renderCards(state.data);
    renderTable();
  });
  document.querySelector('#assets-table thead').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sort.key === key) state.sort.dir *= -1;
    else state.sort = { key, dir: key === 'name' || key === 'category' ? 1 : -1 };
    renderTable();
  });
  const toggleRow = (tr) => {
    if (!tr || !tr.dataset.id) return;
    state.open = state.open === tr.dataset.id ? null : tr.dataset.id;
    renderTable();
  };
  $('assets-body').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    toggleRow(e.target.closest('tr.arow'));
  });
  $('assets-body').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const tr = e.target.closest('tr.arow');
      if (tr) { e.preventDefault(); toggleRow(tr); }
    }
  });
  $('more-btn').addEventListener('click', () => {
    state.expanded = !state.expanded;
    renderTable();
  });
}

function syncUnit() {
  for (const b of document.querySelectorAll('#unit-seg button')) b.classList.toggle('on', b.dataset.unit === state.unit);
}

async function refreshLive() {
  try {
    const res = await fetch(LIVE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('assets-live ' + res.status);
    const live = await res.json();
    const stats = mergeLive(state.data, live);
    state.liveMeta = {
      live: !!live.live,
      degraded: !!live.degraded,
      as_of: live.as_of,
      hits: live.hits || {},
      mergedStock: stats.stock,
    };
    setDataBadge(state.liveMeta, state.baselineAsOf);
    renderMeta(state.data);
    renderCards(state.data);
    renderTable();
  } catch (err) {
    console.warn('assets-live failed; keeping baseline', err);
    state.liveMeta = { live: false, degraded: true, as_of: null, hits: {} };
    setDataBadge(state.liveMeta, state.baselineAsOf);
  }
}

async function init() {
  syncUnit();
  bind();
  try {
    const res = await fetch('/data/assets.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('assets.json ' + res.status);
    const data = await res.json();
    state.data = data;
    state.baselineAsOf = data.as_of || null;
    setDataBadge({ live: false, degraded: true }, state.baselineAsOf);
    renderMeta(data);
    renderCards(data);
    renderTable();
    attachSnapshotButton('#assets-panel', 'global-assets');
    // Non-blocking live refresh over the static baseline
    refreshLive();
  } catch (err) {
    console.warn('assets load failed', err);
    $('asof').textContent = '数据加载失败';
    $('assets-body').innerHTML = '<tr><td colspan="7" class="empty">数据加载失败，请稍后刷新</td></tr>';
  }
}

init();
