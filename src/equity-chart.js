/**
 * Equity curve for 财富自由基金 tab.
 * Reconstructs total assets from fund-checkins daily pnl, anchored so the
 * last point matches holdings.json total_assets_usd when available.
 */

const RANGES = {
  week: { label: '一周', days: 7 },
  month: { label: '一月', days: 30 },
  year: { label: '一年', days: 365 },
};

const SAMPLE_N = 64;
const ANIM_MS = 420;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtMoney(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
  return sign + '$' + abs.toFixed(0);
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return sign + Math.abs(v).toFixed(2) + '%';
}

function fmtAxisDate(s) {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function fmtTipDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${y}-${m}-${d}`;
}

/** Build equity series: { date, equity }[] */
export function buildEquitySeries(checkins, anchorTotal) {
  const series = (checkins && checkins.series) || [];
  if (!series.length) return [];

  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const sumPnl = sorted.reduce((s, p) => s + (Number(p.pnl) || 0), 0);
  const lastAnchor = Number(anchorTotal);
  const base = Number.isFinite(lastAnchor) ? lastAnchor - sumPnl : 137_000;

  let eq = base;
  return sorted.map((p) => {
    eq += Number(p.pnl) || 0;
    return { date: p.date, equity: eq };
  });
}

function filterRange(points, rangeKey) {
  if (!points.length) return [];
  const cfg = RANGES[rangeKey] || RANGES.month;
  const last = parseDate(points[points.length - 1].date);
  const cutoff = new Date(last);
  cutoff.setDate(cutoff.getDate() - (cfg.days - 1));
  const filtered = points.filter((p) => parseDate(p.date) >= cutoff);
  return filtered.length ? filtered : points.slice(-Math.min(points.length, 5));
}

/** Resample to fixed N points for morph-friendly animation */
function resample(points, n = SAMPLE_N) {
  if (!points.length) return [];
  if (points.length === 1) {
    return Array.from({ length: n }, () => ({ ...points[0] }));
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const f = t * (points.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(points.length - 1, i0 + 1);
    const u = f - i0;
    const e0 = points[i0].equity;
    const e1 = points[i1].equity;
    const d0 = parseDate(points[i0].date).getTime();
    const d1 = parseDate(points[i1].date).getTime();
    const mid = new Date(d0 + (d1 - d0) * u);
    const yyyy = mid.getFullYear();
    const mm = String(mid.getMonth() + 1).padStart(2, '0');
    const dd = String(mid.getDate()).padStart(2, '0');
    out.push({ date: `${yyyy}-${mm}-${dd}`, equity: e0 + (e1 - e0) * u });
  }
  return out;
}

function toPath(xs, ys, w, h, pad) {
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const pts = xs.map((x, i) => {
    const px = pad.l + (x / (xs.length - 1 || 1)) * innerW;
    const py = pad.t + (1 - (ys[i] - minY) / span) * innerH;
    return [px, py];
  });
  if (!pts.length) return { line: '', area: '', minY, maxY, pts, span, innerW, innerH };

  let line = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    line += ` C ${cx.toFixed(2)} ${y0.toFixed(2)}, ${cx.toFixed(2)} ${y1.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const baseY = (h - pad.b).toFixed(2);
  const area =
    line +
    ` L ${pts[pts.length - 1][0].toFixed(2)} ${baseY}` +
    ` L ${pts[0][0].toFixed(2)} ${baseY} Z`;
  return { line, area, minY, maxY, pts, span, innerW, innerH };
}

function pickAxisTicks(rawSlice, maxTicks = 5) {
  if (!rawSlice.length) return [];
  if (rawSlice.length === 1) return [{ i: 0, date: rawSlice[0].date }];
  const n = Math.min(maxTicks, rawSlice.length);
  const ticks = [];
  const seen = new Set();
  for (let t = 0; t < n; t++) {
    const i = Math.round((t / (n - 1)) * (rawSlice.length - 1));
    if (seen.has(i)) continue;
    seen.add(i);
    ticks.push({ i, date: rawSlice[i].date });
  }
  return ticks;
}

export function mountEquityChart(root, { points, defaultRange = 'month' } = {}) {
  if (!root) return { destroy() {} };

  let range = defaultRange;
  let displayYs = null;
  let raf = 0;
  let animStart = 0;
  let fromYs = null;
  let toYs = null;
  let currentSlice = [];
  let layout = null; // { minY, span, pts mapping helpers }
  let reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.innerHTML = `
    <div class="eq-head">
      <div class="eq-titles">
        <h2 id="equity-title">净值走势</h2>
        <span class="eq-meta muted" data-eq-meta></span>
      </div>
      <div class="eq-range" role="tablist" aria-label="时间范围">
        ${Object.entries(RANGES)
          .map(
            ([k, v]) =>
              `<button type="button" class="eq-pill" role="tab" data-range="${k}" aria-selected="false">${v.label}</button>`
          )
          .join('')}
      </div>
    </div>
    <div class="eq-stats">
      <div class="eq-stat">
        <span class="lbl">区间末值</span>
        <span class="val" data-eq-last>—</span>
      </div>
      <div class="eq-stat">
        <span class="lbl">区间涨跌</span>
        <span class="val" data-eq-chg>—</span>
      </div>
    </div>
    <div class="eq-canvas-wrap">
      <svg class="eq-svg" viewBox="0 0 720 280" preserveAspectRatio="none" role="img" aria-label="基金净值折线图">
        <defs>
          <linearGradient id="eqAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#F0B90B" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#F0B90B" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="eqLineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#F0B90B" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#F0B90B" stop-opacity="1"/>
          </linearGradient>
        </defs>
        <g class="eq-xaxis" aria-hidden="true"></g>
        <path class="eq-area" fill="url(#eqAreaGrad)" d=""></path>
        <path class="eq-line" fill="none" stroke="url(#eqLineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d=""></path>
        <line class="eq-cross" x1="0" y1="0" x2="0" y2="0" hidden></line>
        <circle class="eq-dot" r="4.5" cx="0" cy="0" hidden></circle>
      </svg>
      <div class="eq-tip" data-eq-tip hidden>
        <div class="eq-tip-date" data-eq-tip-date></div>
        <div class="eq-tip-val" data-eq-tip-val></div>
      </div>
    </div>
  `;

  const wrap = root.querySelector('.eq-canvas-wrap');
  const svg = root.querySelector('.eq-svg');
  const areaEl = root.querySelector('.eq-area');
  const lineEl = root.querySelector('.eq-line');
  const xAxisEl = root.querySelector('.eq-xaxis');
  const crossEl = root.querySelector('.eq-cross');
  const dotEl = root.querySelector('.eq-dot');
  const tipEl = root.querySelector('[data-eq-tip]');
  const tipDateEl = root.querySelector('[data-eq-tip-date]');
  const tipValEl = root.querySelector('[data-eq-tip-val]');
  const metaEl = root.querySelector('[data-eq-meta]');
  const lastEl = root.querySelector('[data-eq-last]');
  const chgEl = root.querySelector('[data-eq-chg]');
  const pills = [...root.querySelectorAll('.eq-pill')];

  const pad = { t: 16, r: 16, b: 36, l: 16 };
  const W = 720;
  const H = 280;

  function hideHover() {
    crossEl.setAttribute('hidden', '');
    dotEl.setAttribute('hidden', '');
    tipEl.hidden = true;
  }

  function paint(ys, rawSlice) {
    currentSlice = rawSlice || [];
    const xs = ys.map((_, i) => i);
    const geo = toPath(xs, ys, W, H, pad);
    lineEl.setAttribute('d', geo.line);
    areaEl.setAttribute('d', geo.area);

    layout = {
      minY: geo.minY,
      span: geo.span || 1,
      n: Math.max(ys.length, 1),
    };

    // X-axis date labels from real trading days
    const ticks = pickAxisTicks(currentSlice, currentSlice.length <= 7 ? currentSlice.length : 5);
    const innerW = W - pad.l - pad.r;
    xAxisEl.innerHTML = ticks
      .map(({ i, date }) => {
        const x =
          pad.l +
          (i / Math.max(currentSlice.length - 1, 1)) * innerW;
        const anchor =
          i === 0 ? 'start' : i === currentSlice.length - 1 ? 'end' : 'middle';
        return `<text class="eq-x-label" x="${x.toFixed(1)}" y="${H - 10}" text-anchor="${anchor}">${fmtAxisDate(date)}</text>`;
      })
      .join('');

    const first = rawSlice[0]?.equity;
    const last = rawSlice[rawSlice.length - 1]?.equity;
    const chg =
      first != null && last != null && first !== 0
        ? ((last - first) / first) * 100
        : null;
    lastEl.textContent = fmtMoney(last);
    chgEl.textContent = fmtPct(chg);
    chgEl.className = 'val ' + (chg == null ? '' : chg >= 0 ? 'up' : 'down');
    const a = rawSlice[0]?.date || '—';
    const b = rawSlice[rawSlice.length - 1]?.date || '—';
    metaEl.textContent = `${a} → ${b} · ${rawSlice.length} 个交易日样本`;
    hideHover();
  }

  function yToPy(equity) {
    const innerH = H - pad.t - pad.b;
    return pad.t + (1 - (equity - layout.minY) / layout.span) * innerH;
  }

  function showHoverAt(clientX) {
    if (!currentSlice.length || !layout) {
      hideHover();
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = ((clientX - rect.left) / rect.width) * W;
    const innerW = W - pad.l - pad.r;
    let t = (svgX - pad.l) / (innerW || 1);
    t = Math.max(0, Math.min(1, t));
    const idx = Math.round(t * (currentSlice.length - 1));
    const pt = currentSlice[idx];
    const px = pad.l + (idx / Math.max(currentSlice.length - 1, 1)) * innerW;
    const py = yToPy(pt.equity);

    crossEl.removeAttribute('hidden');
    crossEl.setAttribute('x1', px.toFixed(1));
    crossEl.setAttribute('x2', px.toFixed(1));
    crossEl.setAttribute('y1', String(pad.t));
    crossEl.setAttribute('y2', String(H - pad.b));

    dotEl.removeAttribute('hidden');
    dotEl.setAttribute('cx', px.toFixed(1));
    dotEl.setAttribute('cy', py.toFixed(1));

    tipDateEl.textContent = fmtTipDate(pt.date);
    tipValEl.textContent = fmtMoney(pt.equity);
    tipEl.hidden = false;

    // Position tip in the wrap (CSS % of wrap)
    const leftPct = (px / W) * 100;
    const topPct = (py / H) * 100;
    tipEl.style.left = `${leftPct}%`;
    tipEl.style.top = `${topPct}%`;
    tipEl.classList.toggle('eq-tip-right', leftPct > 62);
    tipEl.classList.toggle('eq-tip-left', leftPct <= 62);
  }

  function setActivePill() {
    pills.forEach((btn) => {
      const on = btn.dataset.range === range;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.classList.toggle('active', on);
    });
  }

  function targetFor(rangeKey) {
    const slice = filterRange(points, rangeKey);
    return { slice, ys: resample(slice).map((p) => p.equity) };
  }

  function animateTo(rangeKey) {
    range = rangeKey;
    setActivePill();
    const { slice, ys } = targetFor(rangeKey);
    if (!ys.length) {
      paint([], []);
      return;
    }

    if (reduced || !displayYs) {
      displayYs = ys.slice();
      paint(displayYs, slice);
      return;
    }

    cancelAnimationFrame(raf);
    fromYs = displayYs.slice();
    while (fromYs.length < ys.length) fromYs.push(fromYs[fromYs.length - 1]);
    while (fromYs.length > ys.length) fromYs.pop();
    toYs = ys;
    animStart = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - animStart) / ANIM_MS);
      const e = easeOutCubic(t);
      displayYs = fromYs.map((y, i) => y + (toYs[i] - y) * e);
      const op = 0.55 + 0.45 * Math.sin(Math.PI * e);
      areaEl.style.opacity = String(op);
      paint(displayYs, slice);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        displayYs = toYs.slice();
        areaEl.style.opacity = '1';
        paint(displayYs, slice);
      }
    };
    raf = requestAnimationFrame(tick);
  }

  pills.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.range === range) return;
      animateTo(btn.dataset.range);
    });
  });

  const onMove = (ev) => {
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    showHoverAt(clientX);
  };
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerdown', onMove);
  wrap.addEventListener('pointerleave', hideHover);
  wrap.addEventListener('pointercancel', hideHover);

  const initial =
    points.length >= 12 ? defaultRange : points.length >= 5 ? 'week' : 'year';
  animateTo(RANGES[initial] ? initial : 'month');

  return {
    destroy() {
      cancelAnimationFrame(raf);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerdown', onMove);
      wrap.removeEventListener('pointerleave', hideHover);
      wrap.removeEventListener('pointercancel', hideHover);
      root.innerHTML = '';
    },
    setPoints(next) {
      points = next || [];
      displayYs = null;
      animateTo(range);
    },
  };
}

export async function initEquityChart(el, { anchorTotal } = {}) {
  if (!el) return null;
  let checkins = null;
  try {
    const res = await fetch('/data/fund-checkins.json', { cache: 'no-store' });
    if (res.ok) checkins = await res.json();
  } catch {
    /* ignore */
  }
  const points = buildEquitySeries(checkins, anchorTotal);
  if (!points.length) {
    el.innerHTML =
      '<div class="eq-empty muted">暂无净值序列（fund-checkins.json）</div>';
    return null;
  }
  return mountEquityChart(el, { points, defaultRange: 'month' });
}
