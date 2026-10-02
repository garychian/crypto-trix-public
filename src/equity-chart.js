/**
 * 净值走势 for 财富自由基金 tab.
 * Reconstructs total assets from fund-checkins daily pnl, anchored so the
 * last point matches holdings.json total_assets_usd when available.
 *
 * Look: monotone-cubic gold line (no overshoot), gradient area, dashed grid,
 * glowing end dot + latest value, crosshair + tooltip card (date / NAV /
 * day change / change since range start), clip-reveal draw-in animation.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const RANGES = {
  week: { label: '一周', days: 7 },
  month: { label: '一月', days: 30 },
  quarter: { label: '三个月', days: 92 },
  year: { label: '一年', days: 365 },
  all: { label: '全部', days: Infinity },
};

const DRAW_MS = 900;

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

function fmtFull(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}

function fmtDelta(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
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
  return s || '—';
}

const cls = (v) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down');

/** Build equity series: { date, equity, pnl }[] */
export function buildEquitySeries(checkins, anchorTotal) {
  const series = (checkins && checkins.series) || [];
  if (!series.length) return [];

  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const sumPnl = sorted.reduce((s, p) => s + (Number(p.pnl) || 0), 0);
  const lastAnchor = Number(anchorTotal);
  const base = Number.isFinite(lastAnchor) ? lastAnchor - sumPnl : 137_000;

  let eq = base;
  return sorted.map((p) => {
    const pnl = Number(p.pnl) || 0;
    eq += pnl;
    return { date: p.date, equity: eq, pnl };
  });
}

function filterRange(points, rangeKey) {
  if (!points.length) return [];
  const cfg = RANGES[rangeKey] || RANGES.month;
  if (!Number.isFinite(cfg.days)) return points;
  const last = parseDate(points[points.length - 1].date);
  const cutoff = new Date(last);
  cutoff.setDate(cutoff.getDate() - (cfg.days - 1));
  const filtered = points.filter((p) => parseDate(p.date) >= cutoff);
  return filtered.length >= 2 ? filtered : points.slice(-Math.min(points.length, 5));
}

/** Fritsch–Carlson monotone cubic through pts → SVG path (never overshoots). */
function monotonePath(pts) {
  const n = pts.length;
  if (!n) return '';
  const f = (v) => v.toFixed(2);
  if (n === 1) return `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  const dx = [];
  const dy = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    dy.push(pts[i + 1][1] - pts[i][1]);
    m.push(dy[i] / (dx[i] || 1));
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${f(pts[i][0] + h)} ${f(pts[i][1] + t[i] * h)}, ${f(pts[i + 1][0] - h)} ${f(
      pts[i + 1][1] - t[i + 1] * h
    )}, ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`;
  }
  return d;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
}

/** Padded y-domain with nice grid ticks. */
function yScale(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || Math.max(Math.abs(hi) * 0.02, 1);
  const step = niceStep((range * 1.35) / 3);
  const min = Math.floor((lo - range * 0.1) / step) * step;
  const max = Math.ceil((hi + range * 0.2) / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
  return { min, max, step, ticks };
}

function fmtAxisY(v, step) {
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(step < 1e5 ? 2 : 1) + 'M';
  if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(step % 1000 ? 1 : 0) + 'K';
  return '$' + v.toFixed(0);
}

function pickAxisTicks(n, maxTicks) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const k = Math.min(maxTicks, n);
  const out = [];
  for (let t = 0; t < k; t++) {
    const i = Math.round((t / (k - 1)) * (n - 1));
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

export function mountEquityChart(root, { points, defaultRange = 'month' } = {}) {
  if (!root) return { destroy() {} };

  let range = defaultRange;
  let raf = 0;
  let slice = [];
  let geo = null;
  let W = 720;
  let H = 280;
  let uid = Math.random().toString(36).slice(2, 7);
  const reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.innerHTML = `
    <div class="eq-head">
      <div class="eq-titles">
        <h2 id="equity-title">净值走势 NAV</h2>
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
      <svg class="eq-svg" viewBox="0 0 720 280" role="img" aria-label="基金净值折线图">
        <defs>
          <linearGradient id="eqArea-${uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#F0B90B" stop-opacity="0.30"/>
            <stop offset="65%" stop-color="#F0B90B" stop-opacity="0.07"/>
            <stop offset="100%" stop-color="#F0B90B" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="eqLine-${uid}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#C99A0A"/>
            <stop offset="100%" stop-color="#FFD24A"/>
          </linearGradient>
          <clipPath id="eqClip-${uid}"><rect class="eq-clip" x="0" y="-20" width="0" height="600"/></clipPath>
        </defs>
        <g class="eq-grid" aria-hidden="true"></g>
        <g class="eq-xaxis" aria-hidden="true"></g>
        <g clip-path="url(#eqClip-${uid})">
          <path class="eq-area" fill="url(#eqArea-${uid})" d=""></path>
          <path class="eq-line" fill="none" stroke="url(#eqLine-${uid})" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d=""></path>
        </g>
        <g class="eq-end" hidden>
          <circle class="eq-end-halo" r="9"></circle>
          <circle class="eq-end-dot" r="4.2"></circle>
          <text class="eq-end-label"></text>
        </g>
        <line class="eq-cross" x1="0" y1="0" x2="0" y2="0" hidden></line>
        <circle class="eq-dot" r="4.5" cx="0" cy="0" hidden></circle>
      </svg>
      <div class="eq-tip" data-eq-tip hidden>
        <div class="eq-tip-date" data-eq-tip-date></div>
        <div class="eq-tip-val" data-eq-tip-val></div>
        <div class="eq-tip-row"><span>当日</span><b data-eq-tip-day></b></div>
        <div class="eq-tip-row"><span>较区间起点</span><b data-eq-tip-cum></b></div>
      </div>
    </div>
  `;

  const $ = (s) => root.querySelector(s);
  const wrap = $('.eq-canvas-wrap');
  const svg = $('.eq-svg');
  const gridEl = $('.eq-grid');
  const xAxisEl = $('.eq-xaxis');
  const areaEl = $('.eq-area');
  const lineEl = $('.eq-line');
  const clipEl = $('.eq-clip');
  const endEl = $('.eq-end');
  const endHalo = $('.eq-end-halo');
  const endDot = $('.eq-end-dot');
  const endLabel = $('.eq-end-label');
  const crossEl = $('.eq-cross');
  const dotEl = $('.eq-dot');
  const tipEl = $('[data-eq-tip]');
  const tipDate = $('[data-eq-tip-date]');
  const tipVal = $('[data-eq-tip-val]');
  const tipDay = $('[data-eq-tip-day]');
  const tipCum = $('[data-eq-tip-cum]');
  const metaEl = $('[data-eq-meta]');
  const lastEl = $('[data-eq-last]');
  const chgEl = $('[data-eq-chg]');
  const pills = [...root.querySelectorAll('.eq-pill')];

  const padFor = () => ({
    t: 16,
    r: W < 420 ? 14 : 20,
    b: 30,
    l: W < 420 ? 40 : 50,
  });

  function syncSize() {
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === W && h === H) return false;
    W = w;
    H = h;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    return true;
  }

  function hideHover() {
    crossEl.setAttribute('hidden', '');
    dotEl.setAttribute('hidden', '');
    tipEl.hidden = true;
    endLabel.style.opacity = '';
  }

  /** Lay out + paint the full (final) chart for the current slice. */
  function paint() {
    hideHover();
    if (!slice.length) {
      gridEl.innerHTML = xAxisEl.innerHTML = '';
      lineEl.setAttribute('d', '');
      areaEl.setAttribute('d', '');
      endEl.setAttribute('hidden', '');
      return;
    }
    const pad = padFor();
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const ys = slice.map((p) => p.equity);
    const sc = yScale(ys);
    const n = slice.length;
    const px = (i) => pad.l + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
    const py = (v) => pad.t + (1 - (v - sc.min) / (sc.max - sc.min)) * innerH;
    const pts = slice.map((p, i) => [px(i), py(p.equity)]);
    geo = { pad, innerW, innerH, px, py, pts };

    const line = monotonePath(pts);
    const base = (H - pad.b).toFixed(2);
    lineEl.setAttribute('d', line);
    areaEl.setAttribute(
      'd',
      n > 1
        ? `${line} L ${pts[n - 1][0].toFixed(2)} ${base} L ${pts[0][0].toFixed(2)} ${base} Z`
        : ''
    );

    // dashed horizontal grid + muted y labels
    gridEl.innerHTML = sc.ticks
      .map((v) => {
        const y = py(v).toFixed(1);
        return (
          `<line class="eq-grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>` +
          `<text class="eq-y-label" x="${pad.l - 8}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end">${fmtAxisY(v, sc.step)}</text>`
        );
      })
      .join('');

    // x-axis dates (real trading days)
    const ticks = pickAxisTicks(n, W < 420 ? 4 : n <= 7 ? n : 5);
    xAxisEl.innerHTML = ticks
      .map((i) => {
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        const x = i === 0 ? px(i) - 2 : i === n - 1 ? px(i) + 2 : px(i);
        return `<text class="eq-x-label" x="${x.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${fmtAxisDate(slice[i].date)}</text>`;
      })
      .join('');

    // end point: glowing dot + latest value
    const [ex, ey] = pts[n - 1];
    [endHalo, endDot].forEach((c) => {
      c.setAttribute('cx', ex.toFixed(1));
      c.setAttribute('cy', ey.toFixed(1));
    });
    endLabel.textContent = fmtFull(slice[n - 1].equity);
    endLabel.setAttribute('x', (ex - 4).toFixed(1));
    endLabel.setAttribute('y', (ey - 14).toFixed(1));
    endLabel.setAttribute('text-anchor', 'end');
    endEl.removeAttribute('hidden');

    // header stats
    const first = slice[0].equity;
    const last = slice[n - 1].equity;
    const chg = first ? ((last - first) / first) * 100 : null;
    lastEl.textContent = fmtMoney(last);
    chgEl.innerHTML =
      `${fmtDelta(last - first)} <small>${fmtPct(chg)}</small>`;
    chgEl.className = 'val ' + cls(last - first);
    metaEl.textContent = `${slice[0].date} → ${slice[n - 1].date} · ${n} 个交易日`;
  }

  function draw(progress) {
    const pad = geo ? geo.pad : padFor();
    // reveal from left to right (the clip also covers the area fill)
    clipEl.setAttribute('x', '0');
    clipEl.setAttribute('width', String((W * progress).toFixed(1)));
    const done = progress >= 1;
    endEl.style.opacity = done ? '1' : '0';
    endEl.classList.toggle('on', done);
    void pad;
  }

  function play() {
    cancelAnimationFrame(raf);
    if (reduced || !slice.length) {
      draw(1);
      return;
    }
    draw(0);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DRAW_MS);
      draw(easeOutCubic(k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function setRange(key, animate = true) {
    range = RANGES[key] ? key : 'month';
    pills.forEach((b) => {
      const on = b.dataset.range === range;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('active', on);
    });
    slice = filterRange(points, range);
    paint();
    if (animate) play();
    else draw(1);
  }

  function showHoverAt(clientX) {
    if (!slice.length || !geo) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    const n = slice.length;
    const t = Math.max(0, Math.min(1, (x - geo.pad.l) / (geo.innerW || 1)));
    const i = n > 1 ? Math.round(t * (n - 1)) : 0;
    const p = slice[i];
    const [cx, cy] = geo.pts[i];

    crossEl.removeAttribute('hidden');
    crossEl.setAttribute('x1', cx.toFixed(1));
    crossEl.setAttribute('x2', cx.toFixed(1));
    crossEl.setAttribute('y1', String(geo.pad.t));
    crossEl.setAttribute('y2', String(H - geo.pad.b));
    dotEl.removeAttribute('hidden');
    dotEl.setAttribute('cx', cx.toFixed(1));
    dotEl.setAttribute('cy', cy.toFixed(1));
    endLabel.style.opacity = '0';

    const prevEq = p.equity - p.pnl;
    const dayPct = prevEq ? (p.pnl / prevEq) * 100 : null;
    const cum = p.equity - slice[0].equity;
    const cumPct = slice[0].equity ? (cum / slice[0].equity) * 100 : null;
    tipDate.textContent = fmtTipDate(p.date);
    tipVal.textContent = fmtFull(p.equity);
    tipDay.innerHTML = `${fmtDelta(p.pnl)} <small>${fmtPct(dayPct)}</small>`;
    tipDay.className = cls(p.pnl);
    tipCum.innerHTML = i === 0 ? '—' : `${fmtDelta(cum)} <small>${fmtPct(cumPct)}</small>`;
    tipCum.className = i === 0 ? '' : cls(cum);
    tipEl.hidden = false;

    // keep the card inside the chart: flip side + clamp
    const tw = tipEl.offsetWidth || 150;
    let left = cx + 14;
    if (left + tw > W - 4) left = cx - 14 - tw;
    left = Math.max(4, left);
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${geo.pad.t - 4}px`;
  }

  pills.forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.range !== range) setRange(b.dataset.range);
    })
  );

  const onMove = (ev) => showHoverAt(ev.clientX);
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerdown', onMove);
  wrap.addEventListener('pointerleave', hideHover);
  wrap.addEventListener('pointercancel', hideHover);

  syncSize();
  let ro = null;
  let animatedOnce = false;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (syncSize() && slice.length) {
        paint();
        if (animatedOnce) draw(1);
      }
    });
    ro.observe(wrap);
  }

  const initial = points.length >= 12 ? defaultRange : 'all';
  setRange(initial, true);
  animatedOnce = true;

  return {
    destroy() {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerdown', onMove);
      wrap.removeEventListener('pointerleave', hideHover);
      wrap.removeEventListener('pointercancel', hideHover);
      root.innerHTML = '';
    },
    setPoints(next) {
      points = next || [];
      setRange(range);
    },
  };
}

export async function initEquityChart(el, { anchorTotal } = {}) {
  if (!el) return null;
  try {
    let checkins = null;
    try {
      const res = await fetch('/data/fund-checkins.json', { cache: 'no-store' });
      if (res.ok) checkins = await res.json();
    } catch {
      /* ignore */
    }
    const points = buildEquitySeries(checkins, anchorTotal);
    if (!points.length) {
      el.innerHTML = '<div class="eq-empty muted">暂无净值序列（fund-checkins.json）</div>';
      return null;
    }
    return mountEquityChart(el, { points, defaultRange: 'month' });
  } catch (err) {
    console.warn('equity chart failed', err);
    el.innerHTML = '<div class="eq-empty muted">净值走势暂时无法显示</div>';
    return null;
  }
}
