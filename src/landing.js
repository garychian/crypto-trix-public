import './nav.js';
import { DEMO_PRICES } from './data/demo.js';
import { loadHoldingsData } from './lib/holdings.js';
import { usd, escapeHTML } from './lib/format.js';

const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
/** Mon→Sun labels (weekend rows keep Saturday check-ins visible). */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];
const DAYS_PER_WEEK = 7;

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
  if (pnl === 0 || pnl == null || !Number.isFinite(pnl)) return 'flat';
  const lvl = intensityLevel(Math.abs(pnl));
  return (pnl > 0 ? 'up-' : 'down-') + lvl + ' has-data';
}

function cellTitle(iso, entry) {
  if (!entry) return `${iso} · 无打卡`;
  const sign = entry.pnl >= 0 ? '+' : '−';
  const amt = Math.abs(Math.round(entry.pnl)).toLocaleString('en-US');
  return `${iso} · Day ${entry.day} · ${sign}$${amt}`;
}

/** Week columns Mon–Sun from fund start through endISO. */
function buildWeekColumns(startISO, endISO) {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const first = new Date(start);
  const monOffset = first.getDay() === 0 ? -6 : 1 - first.getDay();
  first.setDate(first.getDate() + monOffset);

  const weeks = [];
  const cursor = new Date(first);
  while (cursor <= end || weeks.length === 0) {
    const week = [];
    let anyInRange = false;
    for (let i = 0; i < DAYS_PER_WEEK; i++) {
      const day = new Date(cursor);
      day.setDate(cursor.getDate() + i);
      const iso = formatISODate(day);
      const inRange = day >= start && day <= end;
      if (inRange) anyInRange = true;
      week.push(inRange ? iso : null);
    }
    if (anyInRange) weeks.push(week);
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

async function renderHeatmap() {
  const root = document.getElementById('fund-heatmap');
  const sub = document.getElementById('checkin-sub');
  const wrap = document.getElementById('heatmap-wrap');
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
  const startISO = data.start || '2026-07-16';
  const endISO =
    data.as_of ||
    (series.length ? series[series.length - 1].date : startISO);

  const weeks = buildWeekColumns(startISO, endISO);
  const months = monthLabelsForWeeks(weeks);

  const ups = series.filter((e) => e.pnl > 0).length;
  const downs = series.filter((e) => e.pnl < 0).length;
  if (sub) {
    sub.textContent = `${startISO} → ${endISO} · ${series.length} 个交易日打卡 · 涨 ${ups} / 跌 ${downs}`;
  }

  let monthsEl = wrap.querySelector('.heatmap-months');
  if (!monthsEl) {
    monthsEl = document.createElement('div');
    monthsEl.className = 'heatmap-months';
    wrap.insertBefore(monthsEl, wrap.firstChild);
  }
  monthsEl.innerHTML = months
    .map(
      (lab) =>
        `<span style="display:inline-block;width:17px;min-width:17px;overflow:visible;white-space:nowrap">${escapeHTML(lab)}</span>`
    )
    .join('');

  let labeled = wrap.querySelector('.heatmap-with-labels');
  if (!labeled) {
    labeled = document.createElement('div');
    labeled.className = 'heatmap-with-labels';
    const scroll = wrap.querySelector('.heatmap-scroll');
    wrap.insertBefore(labeled, scroll);
    labeled.appendChild(
      Object.assign(document.createElement('div'), { className: 'heatmap-ydays' })
    );
    labeled.appendChild(scroll);
  }
  const ydays = labeled.querySelector('.heatmap-ydays');
  ydays.innerHTML = WEEKDAY_LABELS.map((d) => `<span>${d}</span>`).join('');

  const cells = [];
  for (const week of weeks) {
    for (let i = 0; i < DAYS_PER_WEEK; i++) {
      const iso = week[i];
      if (!iso) {
        cells.push('<span class="cell empty" aria-hidden="true"></span>');
        continue;
      }
      const entry = byDate.get(iso);
      const cls = cellClass(entry);
      const title = escapeHTML(cellTitle(iso, entry));
      cells.push(`<span class="cell ${cls}" title="${title}"></span>`);
    }
  }
  root.innerHTML = cells.join('');
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
}

boot();
