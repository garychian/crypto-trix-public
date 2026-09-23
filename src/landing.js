import './nav.js';
import { renderVixGauge } from './vix-gauge.js';
import { renderJourneyRings } from './journey-rings.js';
import { DEMO_PRICES } from './data/demo.js';
import { loadHoldingsData } from './lib/holdings.js';
import { usd, usdSigned, escapeHTML } from './lib/format.js';

const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
/** Mon→Sun labels (weekend rows keep Saturday check-ins visible). */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];
const DAYS_PER_WEEK = 7;
const YEAR = 2026;

function msLabel(v) {
  return v >= 1e6 ? '$' + v / 1e6 + 'M' : '$' + v / 1e3 + 'K';
}

function computeAssets(holdings, cash, prices) {
  let holdingsMV = 0;
  for (const h of holdings) {
    const q = prices[h.ticker];
    const px = q?.price ?? h.price;
    if (px == null || !Number.isFinite(px)) continue;
    const shares = h.mv != null && h.price != null ? h.mv / h.price : h.shares;
    holdingsMV += px * shares;
  }
  return holdingsMV + (cash != null ? cash : 0);
}

/** Parse YYYY-MM-DD as local calendar date (no UTC shift). */
function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatISODate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function intensityLevel(absPnl) {
  if (absPnl < 600) return 1;
  if (absPnl < 1500) return 2;
  return 3;
}

function cellClass(entry) {
  if (!entry) return 'empty';
  const pnl = entry.pnl;
  if (pnl === 0 || pnl == null || !Number.isFinite(pnl)) return 'flat has-data';
  const lvl = intensityLevel(Math.abs(pnl));
  return (pnl > 0 ? 'up-' : 'down-') + lvl + ' has-data';
}

function formatPnl(pnl) {
  if (pnl == null || !Number.isFinite(pnl)) return '—';
  const sign = pnl >= 0 ? '+' : '−';
  const amt = Math.abs(Math.round(pnl)).toLocaleString('en-US');
  return `${sign}$${amt}`;
}

/**
 * Where a check-in cell click should land: the exact X post when we have it
 * (entry.tweet in fund-checkins.json), else X search scoped to that day AND
 * the daily-tweet keyword — which pins it to precisely that day's 持仓速览 post.
 */
function tweetLinkFor(iso, entry) {
  if (entry && entry.tweet) return entry.tweet;
  const next = formatISODate(new Date(parseISODate(iso).getTime() + 86400000));
  const q = encodeURIComponent(
    `from:CryptoTrix1 "财富自由基金每日持仓速览" since:${iso} until:${next}`
  );
  return `https://x.com/search?q=${q}&src=typed_query&f=live`;
}

function tipHTML(iso, entry) {
  const dateLine = escapeHTML(iso);
  if (!entry) {
    return `<div class="tip-date">${dateLine}</div><div class="tip-muted">无打卡</div>`;
  }
  const dayLine =
    entry.day != null
      ? `<div class="tip-day">Day ${escapeHTML(String(entry.day))}</div>`
      : '';
  const pnl = entry.pnl;
  const cls =
    pnl > 0 ? 'tip-up' : pnl < 0 ? 'tip-down' : 'tip-flat';
  return (
    `<div class="tip-date">${dateLine}</div>` +
    dayLine +
    `<div class="tip-pnl ${cls}">${escapeHTML(formatPnl(pnl))}</div>` +
    `<div class="tip-link">点击打开当日 X 帖子 ↗</div>`
  );
}

/**
 * Full-year GitHub-style week columns (Mon–Sun) for calendar year `year`.
 * Cells outside the year are null (muted placeholders).
 */
function buildYearWeekColumns(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const first = new Date(start);
  const monOffset = first.getDay() === 0 ? -6 : 1 - first.getDay();
  first.setDate(first.getDate() + monOffset);

  const weeks = [];
  const cursor = new Date(first);
  while (cursor <= end || weeks.length === 0) {
    const week = [];
    let anyInYear = false;
    for (let i = 0; i < DAYS_PER_WEEK; i++) {
      const day = new Date(cursor);
      day.setDate(cursor.getDate() + i);
      const iso = formatISODate(day);
      const inYear = day.getFullYear() === year;
      if (inYear) anyInYear = true;
      week.push(inYear ? iso : null);
    }
    if (anyInYear) weeks.push(week);
    else if (weeks.length) break;
    cursor.setDate(cursor.getDate() + 7);
    if (weeks.length > 60) break;
  }
  return weeks;
}

function monthLabelsForWeeks(weeks) {
  const labels = [];
  let prevMonth = -1;
  for (const week of weeks) {
    const firstDay = week.find(Boolean);
    if (!firstDay) {
      labels.push('');
      continue;
    }
    const m = parseISODate(firstDay).getMonth();
    if (m !== prevMonth) {
      labels.push(MONTH_LABELS[m]);
      prevMonth = m;
    } else {
      labels.push('');
    }
  }
  return labels;
}

function bindHeatmapTip(root, tip) {
  let activeCell = null;
  let pinned = false;

  function hide() {
    tip.hidden = true;
    tip.classList.remove('visible');
    if (activeCell) activeCell.classList.remove('tip-active');
    activeCell = null;
    pinned = false;
  }

  function place(cell) {
    const wrap = tip.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    tip.hidden = false;
    tip.classList.add('visible');
    // Measure after visible
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    let left = cellRect.left - wrapRect.left + cellRect.width / 2 - tipW / 2;
    let top = cellRect.top - wrapRect.top - tipH - 10;
    left = Math.max(4, Math.min(left, wrapRect.width - tipW - 4));
    if (top < 4) {
      top = cellRect.bottom - wrapRect.top + 10;
      tip.classList.add('below');
    } else {
      tip.classList.remove('below');
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function show(cell, { pin = false } = {}) {
    const iso = cell.dataset.date;
    if (!iso) return;
    const entry = cell._entry || null;
    tip.innerHTML = tipHTML(iso, entry);
    if (activeCell) activeCell.classList.remove('tip-active');
    activeCell = cell;
    cell.classList.add('tip-active');
    pinned = pin;
    place(cell);
  }

  root.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.cell[data-date]');
    if (!cell || !root.contains(cell)) return;
    if (pinned && activeCell === cell) return;
    show(cell, { pin: false });
  });

  root.addEventListener('mouseout', (e) => {
    if (pinned) return;
    const to = e.relatedTarget;
    if (to && root.contains(to) && to.closest?.('.cell[data-date]')) return;
    if (to === tip || tip.contains(to)) return;
    hide();
  });

  root.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell[data-date]');
    if (!cell || !root.contains(cell)) return;
    e.preventDefault();
    e.stopPropagation();
    // Check-in days link out to that day's X post (exact URL or day-scoped search)
    if (cell._entry) {
      hide();
      window.open(tweetLinkFor(cell.dataset.date, cell._entry), '_blank', 'noopener');
      return;
    }
    if (pinned && activeCell === cell) {
      hide();
      return;
    }
    show(cell, { pin: true });
  });

  document.addEventListener('click', (e) => {
    if (!pinned) return;
    if (tip.contains(e.target)) return;
    if (activeCell && activeCell.contains(e.target)) return;
    hide();
  });

  tip.addEventListener('click', (e) => e.stopPropagation());
}

async function renderHeatmap() {
  const root = document.getElementById('fund-heatmap');
  const sub = document.getElementById('checkin-sub');
  const wrap = document.getElementById('heatmap-wrap');
  const monthsEl = document.getElementById('heatmap-months');
  const ydays = document.getElementById('heatmap-ydays');
  const tip = document.getElementById('heatmap-tip');
  if (!root || !wrap) return;

  let data;
  try {
    const res = await fetch('/data/fund-checkins.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch {
    if (sub) sub.textContent = '打卡数据加载失败';
    return;
  }

  const series = Array.isArray(data.series) ? data.series : [];
  const byDate = new Map(series.map((e) => [e.date, e]));
  const year = YEAR;
  const startISO = `${year}-01-01`;
  const endISO = `${year}-12-31`;

  const weeks = buildYearWeekColumns(year);
  const months = monthLabelsForWeeks(weeks);

  const ups = series.filter((e) => e.pnl > 0).length;
  const downs = series.filter((e) => e.pnl < 0).length;
  if (sub) {
    sub.textContent = `${startISO} → ${endISO} · ${series.length} 个交易日打卡 · 涨 ${ups} / 跌 ${downs} · 点击色块看当日帖`;
  }

  if (monthsEl) {
    monthsEl.innerHTML = months
      .map(
        (lab) =>
          `<span class="hm-month">${escapeHTML(lab)}</span>`
      )
      .join('');
  }

  if (ydays) {
    ydays.innerHTML = WEEKDAY_LABELS.map((d) => `<span>${d}</span>`).join('');
  }

  const cells = [];
  for (const week of weeks) {
    for (let i = 0; i < DAYS_PER_WEEK; i++) {
      const iso = week[i];
      if (!iso) {
        cells.push('<span class="cell empty out" aria-hidden="true"></span>');
        continue;
      }
      const entry = byDate.get(iso);
      const cls = cellClass(entry);
      cells.push(
        `<button type="button" class="cell ${cls}" data-date="${escapeHTML(iso)}" aria-label="${escapeHTML(iso)}"></button>`
      );
    }
  }
  root.innerHTML = cells.join('');

  // Attach entry payloads for tip (avoid huge data-* attrs)
  root.querySelectorAll('.cell[data-date]').forEach((el) => {
    el._entry = byDate.get(el.dataset.date) || null;
  });

  if (tip) bindHeatmapTip(root, tip);
}

function formatCurrentHeadline(stats) {
  const day = stats.day != null ? `Day ${stats.day}` : 'Day —';
  const total = `总资产约 ${usd(stats.total_assets_usd)}`;
  const pnl = `累计盈亏 ${usdSigned(stats.cum_pnl_usd)}`;
  const ann =
    stats.annualized_return_pct != null && Number.isFinite(stats.annualized_return_pct)
      ? `年化约 ${stats.annualized_return_pct.toFixed(2)}%`
      : '年化 —';
  return `${day} · ${total} · ${pnl} · ${ann}`;
}

function formatCurrentBody(stats) {
  const asOf = stats.as_of ? `as_of ${stats.as_of}。` : '';
  return `${asOf}2026 年化目标 20%。A股基金约 107 万人民币配置另页公开；数字会随 holdings.json 刷新。`;
}

function chipHTML(chips) {
  if (!Array.isArray(chips) || !chips.length) return '';
  return (
    `<div class="tl-chips">` +
    chips
      .map((c) => {
        const href = escapeHTML(c.href || '#');
        const label = escapeHTML(c.label || '');
        const external = /^https?:/i.test(c.href || '');
        const extra = external ? ' target="_blank" rel="noopener"' : '';
        return `<a class="tl-chip" href="${href}"${extra}>${label}</a>`;
      })
      .join('') +
    `</div>`
  );
}

function entryHTML(entry, holdings) {
  const live = !!entry.live;
  let headline = entry.headline || '';
  let body = entry.body || '';
  let asOf = entry.as_of || entry.fallback?.as_of || '';
  const dateLabel = entry.date_label || '';

  if (live) {
    const fb = entry.fallback || {};
    const stats = {
      day: holdings?.day ?? fb.day,
      total_assets_usd: holdings?.total_assets_usd ?? fb.total_assets_usd,
      cum_pnl_usd: holdings?.cum_pnl_usd ?? fb.cum_pnl_usd,
      annualized_return_pct:
        holdings?.annualized_return_pct ?? fb.annualized_return_pct,
      as_of: holdings?.as_of ?? fb.as_of ?? asOf,
    };
    headline = formatCurrentHeadline(stats);
    body = formatCurrentBody(stats);
    asOf = stats.as_of || asOf;
  }

  const cls = live ? 'tl-item tl-current' : 'tl-item';
  const idAttr = entry.id ? ` data-id="${escapeHTML(entry.id)}"` : '';
  const headlineId = live ? ' id="tl-current-headline"' : '';
  const bodyId = live ? ' id="tl-current-body"' : '';
  const asofHtml = live
    ? ` <span class="tl-asof muted" id="tl-asof">as_of ${escapeHTML(String(asOf || '—'))}</span>`
    : '';

  return (
    `<li class="${cls}"${idAttr}>` +
    `<div class="tl-rail" aria-hidden="true"><span class="tl-dot"></span></div>` +
    `<div class="tl-card panel">` +
    `<div class="tl-date">${escapeHTML(dateLabel)}${asofHtml}</div>` +
    `<h3 class="tl-headline"${headlineId}>${escapeHTML(headline)}</h3>` +
    `<p class="tl-body"${bodyId}>${escapeHTML(body)}</p>` +
    chipHTML(entry.chips) +
    `</div></li>`
  );
}

async function renderTimeline(holdings) {
  const list = document.getElementById('timeline-list');
  if (!list) return;

  let data = null;
  try {
    const res = await fetch('/data/timeline.json', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch {
    /* keep static HTML fallback */
  }

  if (!data || !Array.isArray(data.entries)) {
    patchCurrentTimeline(holdings);
    return;
  }

  const eyebrow = document.getElementById('timeline-eyebrow');
  const title = document.getElementById('timeline-title');
  const intro = document.getElementById('timeline-intro');
  if (eyebrow && data.eyebrow) eyebrow.textContent = data.eyebrow;
  if (title && data.title) title.textContent = data.title;
  if (intro && data.intro) intro.textContent = data.intro;

  list.innerHTML = data.entries.map((e) => entryHTML(e, holdings)).join('');
}

function patchCurrentTimeline(holdings) {
  if (!holdings) return;
  const headlineEl = document.getElementById('tl-current-headline');
  const bodyEl = document.getElementById('tl-current-body');
  const asofEl = document.getElementById('tl-asof');
  const stats = {
    day: holdings.day,
    total_assets_usd: holdings.total_assets_usd,
    cum_pnl_usd: holdings.cum_pnl_usd,
    annualized_return_pct: holdings.annualized_return_pct,
    as_of: holdings.as_of,
  };
  if (headlineEl) headlineEl.textContent = formatCurrentHeadline(stats);
  if (bodyEl) bodyEl.textContent = formatCurrentBody(stats);
  if (asofEl && stats.as_of) asofEl.textContent = `as_of ${stats.as_of}`;
}

async function boot() {
  const data = await loadHoldingsData();
  const total =
    data.total_assets_usd != null
      ? data.total_assets_usd
      : computeAssets(data.holdings, data.cash_usd, DEMO_PRICES);
  const goal = data.goal_usd || 2_000_000;
  const progress = (total / goal) * 100;
  const clamped = Math.min(100, progress);

  document.getElementById('hero-pct').textContent = progress.toFixed(2) + '%';
  document.getElementById('hero-assets').textContent = '总资产 ' + usd(total);
  document.getElementById('hero-fill').style.width = clamped + '%';
  document.getElementById('hero-knob').style.left = clamped + '%';

  document.getElementById('hero-ms').innerHTML = MILESTONES.map((v) => {
    const hit = total >= v;
    return `<span class="${hit ? 'hit' : ''}">${hit ? '✓ ' : ''}${msLabel(v)}</span>`;
  }).join('');

  await renderHeatmap();
  renderJourneyRings(data);
  await renderVixGauge();
  await renderTimeline(data);
}

boot();
