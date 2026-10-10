/**
 * 公开历程 → 周总结 / 月总结 feed (data only, fixed templates, no commentary).
 * Source: /data/summaries.json (scripts/generate-summaries.mjs). Origin milestones from /data/timeline.json.
 * Every summary card gets the 保存为图片 button.
 */
import { usd, usdSigned, pctSigned, escapeHTML } from './lib/format.js';
import { attachSnapshotButton } from './lib/snapshot.js';

const MAX_WEEKS = 4;
const MAX_MONTHS = 3;

const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const cny = (wan) => '¥' + Math.round(wan * 10000).toLocaleString('en-US');
const cnyDelta = (wan) => (wan >= 0 ? '+' : '−') + '¥' + Math.abs(Math.round(wan * 10000)).toLocaleString('en-US');
const mmdd = (s) => s.slice(5).replace('-', '/');
const KIND = { new: '新建仓', closed: '清仓', added: '加仓', trimmed: '减仓' };
const sh = (n) => (n > 0 ? '+' : '−') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

function periodLabel(e) {
  if (e.type === 'month') return `${e.id.slice(0, 4)} 年 ${Number(e.id.slice(5, 7))} 月`;
  return `${mmdd(e.period_start)} → ${mmdd(e.period_end)}`;
}

function tile(k, v, sub, valCls = '') {
  return (
    `<div class="sm-stat"><span class="k">${escapeHTML(k)}</span>` +
    `<b class="${valCls}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`
  );
}

function cardHTML(e, child) {
  const u = e.us || {};
  const isMonth = e.type === 'month';
  const pnlCls = cls(u.pnl_usd);
  const head =
    `<header class="sm-head"><span class="sm-badge">${isMonth ? '月总结' : '周总结'}</span>` +
    `<span class="sm-period">${escapeHTML(periodLabel(e))}` +
    (isMonth ? '' : `<em>${escapeHTML(e.id.slice(5))}</em>`) +
    `</span>${e.partial ? '<span class="sm-flag">进行中</span>' : ''}</header>`;

  const main =
    `<div class="sm-main"><div class="sm-pnl ${pnlCls}">${usdSigned(u.pnl_usd)}</div>` +
    (u.pct != null ? `<div class="sm-pct ${pnlCls}">${pctSigned(u.pct)}</div>` : '') +
    `<div class="sm-sub">美股账户盈亏 · ${usd(u.total_start)} → ${usd(u.total_end)}</div></div>`;

  const tiles = [];
  tiles.push(tile('美股', usd(u.total_end), ''));
  if (e.cn) {
    tiles.push(
      tile(
        'A股基金',
        cny(e.cn.total_wan_end),
        e.cn.change_wan != null
          ? `<span class="${cls(e.cn.change_wan)}">${cnyDelta(e.cn.change_wan)}</span>`
          : `${mmdd(e.cn.as_of)} 快照`
      )
    );
  }
  if (e.combined && e.combined.total_usd_end != null) {
    tiles.push(tile('合计', '≈ ' + usd(e.combined.total_usd_end), e.combined.fx_usdcny ? `汇率 ${e.combined.fx_usdcny.toFixed(2)}` : ''));
  }
  if (e.combined && e.combined.ytd_pct != null) {
    tiles.push(
      tile('今年', pctSigned(e.combined.ytd_pct), `<span class="${cls(e.combined.ytd_usd)}">${usdSigned(e.combined.ytd_usd)}</span>`, cls(e.combined.ytd_pct))
    );
  }
  if (u.cash_pct_end != null) {
    tiles.push(
      tile(
        '现金占比',
        u.cash_pct_end.toFixed(1) + '%',
        u.cash_pct_start != null ? `期初 ${u.cash_pct_start.toFixed(1)}%` : ''
      )
    );
  }

  const chips = [];
  const rowChips = (label, arr, mk) =>
    arr && arr.length
      ? `<div class="sm-row"><span class="sm-rl">${label}</span>${arr.map(mk).join('')}</div>`
      : '';
  chips.push(
    rowChips('涨幅贡献', u.top_gainers, (g) => `<span class="sm-chip up">${escapeHTML(g.ticker)} ${usdSigned(g.contribution_usd)}</span>`)
  );
  chips.push(
    rowChips('跌幅贡献', u.top_losers, (g) => `<span class="sm-chip down">${escapeHTML(g.ticker)} ${usdSigned(g.contribution_usd)}</span>`)
  );
  chips.push(
    rowChips(
      '仓位变动',
      u.position_changes,
      (c) => `<span class="sm-chip ${c.kind === 'added' || c.kind === 'new' ? 'add' : 'cut'}">${escapeHTML(c.ticker)} ${KIND[c.kind]} ${sh(c.shares_delta)}</span>`
    )
  );

  const notes = [];
  if ((u.top_gainers && u.top_gainers.length) || (u.top_losers && u.top_losers.length)) notes.push('贡献 = 期初持仓 × 价格变动，不含交易与现金');
  if (u.start_derived) notes.push('期初按打卡盈亏反推');
  if (u.unreconciled_usd != null) notes.push(`期初→期末与打卡盈亏相差 ${usdSigned(u.unreconciled_usd)}（券商校准 / 资金变动）`);
  const foot = notes.length ? `<p class="sm-note">${notes.map(escapeHTML).join(' · ')}</p>` : '';

  return (
    `<article class="sm-card panel ${isMonth ? 'sm-month' : 'sm-week'}${child ? ' sm-child' : ''}" data-id="${escapeHTML(e.type + '-' + e.id)}">` +
    head +
    main +
    `<div class="sm-stats">${tiles.join('')}</div>` +
    chips.join('') +
    foot +
    `</article>`
  );
}

function originHTML(entries) {
  if (!entries.length) return '';
  return (
    `<div class="sm-origin"><div class="sm-origin-h"><span>起点</span><em>Origin</em></div><ul>` +
    entries
      .map(
        (e) =>
          `<li><span class="d">${escapeHTML(e.date_label || '')}</span><span class="t">${escapeHTML(e.headline || '')}</span></li>`
      )
      .join('') +
    `</ul></div>`
  );
}

export async function renderSummaryFeed() {
  const root = document.getElementById('summary-feed');
  if (!root) return;

  let list = [];
  let origin = [];
  try {
    const res = await fetch('/data/summaries.json', { cache: 'no-store' });
    if (res.ok) list = await res.json();
  } catch {
    /* empty state below */
  }
  try {
    const res = await fetch('/data/timeline.json', { cache: 'no-store' });
    if (res.ok) {
      const t = await res.json();
      origin = (t.entries || []).filter((e) => !e.live && e.id !== 'current');
    }
  } catch {
    /* origin is optional */
  }

  if (!Array.isArray(list)) list = [];
  list = list.filter((e) => e && e.us && Number.isFinite(e.us.pnl_usd));
  list.sort((a, b) => b.period_end.localeCompare(a.period_end) || (a.type === 'month' ? -1 : 1));

  if (!list.length) {
    root.innerHTML = '<p class="sm-empty muted">周 / 月总结生成中，数据更新后自动出现。</p>' + originHTML(origin);
    return;
  }

  const months = list.filter((e) => e.type === 'month');
  const monthIds = new Set(months.map((m) => m.id));
  const weeks = list.filter((e) => e.type === 'week');
  const childOf = new Map();
  const standalone = [];
  for (const w of weeks) {
    const mid = w.period_end.slice(0, 7);
    if (monthIds.has(mid)) {
      if (!childOf.has(mid)) childOf.set(mid, []);
      childOf.get(mid).push(w);
    } else standalone.push(w);
  }
  const top = [...standalone, ...months].sort(
    (a, b) => b.period_end.localeCompare(a.period_end) || (a.type === 'month' ? -1 : 1)
  );

  let wk = 0;
  let mo = 0;
  const shown = [];
  const hidden = [];
  for (const e of top) {
    if (e.type === 'week') (++wk <= MAX_WEEKS ? shown : hidden).push(e);
    else (++mo <= MAX_MONTHS ? shown : hidden).push(e);
  }

  const block = (e) => {
    if (e.type !== 'month') return cardHTML(e, false);
    const kids = childOf.get(e.id) || [];
    return (
      `<div class="sm-group">` +
      cardHTML(e, false) +
      (kids.length
        ? `<button type="button" class="sm-toggle" aria-expanded="false" data-n="${kids.length}">展开 ${kids.length} 个周总结 <i>▾</i></button>` +
          `<div class="sm-kids" hidden>${kids.map((k) => cardHTML(k, true)).join('')}</div>`
        : '') +
      `</div>`
    );
  };

  root.innerHTML =
    `<div class="sm-list">${shown.map(block).join('')}</div>` +
    (hidden.length
      ? `<div class="sm-list sm-more" hidden>${hidden.map(block).join('')}</div>` +
        `<button type="button" class="sm-toggle sm-more-btn" aria-expanded="false">查看更多 ${hidden.length} 条 <i>▾</i></button>`
      : '') +
    originHTML(origin);

  root.querySelectorAll('.sm-card').forEach((c) => attachSnapshotButton(c, 'summary-' + c.dataset.id));

  root.querySelectorAll('.sm-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.classList.contains('sm-more-btn')
        ? root.querySelector('.sm-more')
        : btn.nextElementSibling;
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      if (target) target.hidden = !open;
      const n = btn.dataset.n;
      if (btn.classList.contains('sm-more-btn')) {
        btn.firstChild.textContent = open ? '收起 ' : `查看更多 ${hidden.length} 条 `;
        if (open) btn.firstChild.textContent = '收起 ';
      } else {
        btn.firstChild.textContent = open ? '收起周总结 ' : `展开 ${n} 个周总结 `;
      }
    });
  });
}
