/**
 * 周度走势 for A股基金 tab.
 * Multi-series SVG chart: thick gold total + thinner category lines.
 * Data: public/data/cn-fund-history.json
 * Look mirrors equity-chart.js (monotone cubic, gradient under total,
 * dashed grid, crosshair + tooltip, clip-reveal draw-in).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Category colours (must stay in sync with cn-fund.js CAT_COLORS). */
export const CN_CAT_COLORS = {
  固收: '#4C6FF7',
  A股: '#E8A838',
  海外: '#0ECB81',
  港股: '#F6465D',
  商品: '#C084FC',
};

const TOTAL_COLOR = '#F0B90B';

const RANGES = {
  month: { label: '一月', days: 31 },
  quarter: { label: '三个月', days: 92 },
  half: { label: '半年', days: 183 },
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

function wan(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtAxisDate(s) {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function fmtAxisY(v, step) {
  if (Math.abs(v) >= 100) return wan(v, step < 5 ? 1 : 0);
  return wan(v, step < 1 ? 2 : 1);
}

function catColor(name) {
  return CN_CAT_COLORS[name] || '#9AA4B2';
}

/** Fritsch–Carlson monotone cubic → SVG path. */
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

function yScale(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || Math.max(Math.abs(hi) * 0.05, 1);
  const step = niceStep((range * 1.35) / 3);
  const min = Math.max(0, Math.floor((lo - range * 0.12) / step) * step);
  const max = Math.ceil((hi + range * 0.18) / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
  return { min, max, step, ticks };
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

function filterRange(points, rangeKey) {
  if (!points.length) return [];
  const cfg = RANGES[rangeKey] || RANGES.all;
  if (!Number.isFinite(cfg.days)) return points;
  const last = parseDate(points[points.length - 1].date);
  const cutoff = new Date(last);
  cutoff.setDate(cutoff.getDate() - (cfg.days - 1));
  const filtered = points.filter((p) => parseDate(p.date) >= cutoff);
  return filtered.length >= 1 ? filtered : points.slice(-1);
}

/** Normalize history payload → sorted points [{date, total_wan, categories:{}}] */
export function normalizeHistory(raw) {
  const series = Array.isArray(raw) ? raw : (raw && raw.series) || [];
  return series
    .filter((p) => p && p.date && Number.isFinite(Number(p.total_wan)))
    .map((p) => ({
      date: p.date,
      total_wan: Number(p.total_wan),
      categories: { ...(p.categories || {}) },
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function collectCatKeys(points) {
  const seen = new Map();
  for (const p of points) {
    for (const k of Object.keys(p.categories || {})) {
      if (!seen.has(k)) seen.set(k, true);
    }
  }
  // Prefer known order from CAT_COLORS, then any extras
  const preferred = Object.keys(CN_CAT_COLORS);
  const keys = preferred.filter((k) => seen.has(k));
  for (const k of seen.keys()) {
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

function el(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) n.setAttribute(k, String(v));
  }
  if (text != null) n.textContent = text;
  return n;
}

export function mountCnFundChart(root, { points, defaultRange = 'all' } = {}) {
  if (!root) return { destroy() {} };

  let range = defaultRange;
  let raf = 0;
  let slice = [];
  let geo = null;
  let catKeys = [];
  let W = 720;
  let H = 300;
  let uid = Math.random().toString(36).slice(2, 7);
  const reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  const showRange = points.length >= 3;

  root.innerHTML = `
    <div class="cnh-head">
      <div class="cnh-titles">
        <h2 id="cn-hist-title">周度走势</h2>
        <span class="cnh-meta muted" data-cnh-meta></span>
      </div>
      ${
        showRange
          ? `<div class="cnh-range" role="tablist" aria-label="时间范围">
        ${Object.entries(RANGES)
          .map(
            ([k, v]) =>
              `<button type="button" class="cnh-pill" role="tab" data-range="${k}" aria-selected="false">${v.label}</button>`
          )
          .join('')}
      </div>`
          : ''
      }
    </div>
    <div class="cnh-stats">
      <div class="cnh-stat">
        <span class="lbl">最新总额</span>
        <span class="val" data-cnh-last>—</span>
      </div>
      <div class="cnh-stat">
        <span class="lbl">较首期</span>
        <span class="val" data-cnh-chg>—</span>
      </div>
    </div>
    <div class="cnh-legend" data-cnh-legend aria-hidden="false"></div>
    <div class="cnh-canvas-wrap">
      <svg class="cnh-svg" viewBox="0 0 720 300" role="img" aria-label="A股基金周度总资产与分类折线图">
        <defs>
          <linearGradient id="cnhArea-${uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#F0B90B" stop-opacity="0.28"/>
            <stop offset="65%" stop-color="#F0B90B" stop-opacity="0.06"/>
            <stop offset="100%" stop-color="#F0B90B" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="cnhLine-${uid}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#C99A0A"/>
            <stop offset="100%" stop-color="#FFD24A"/>
          </linearGradient>
          <clipPath id="cnhClip-${uid}"><rect class="cnh-clip" x="0" y="-20" width="0" height="600"/></clipPath>
        </defs>
        <g class="cnh-grid" aria-hidden="true"></g>
        <g class="cnh-xaxis" aria-hidden="true"></g>
        <g clip-path="url(#cnhClip-${uid})">
          <path class="cnh-area" fill="url(#cnhArea-${uid})" d=""></path>
          <g class="cnh-cats"></g>
          <path class="cnh-total" fill="none" stroke="url(#cnhLine-${uid})" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d=""></path>
          <g class="cnh-dots"></g>
        </g>
        <g class="cnh-end" hidden>
          <circle class="cnh-end-halo" r="9"></circle>
          <circle class="cnh-end-dot" r="4.2"></circle>
          <text class="cnh-end-label"></text>
        </g>
        <line class="cnh-cross" x1="0" y1="0" x2="0" y2="0" hidden></line>
        <g class="cnh-hover-dots"></g>
      </svg>
      <div class="cnh-tip" data-cnh-tip hidden>
        <div class="cnh-tip-date" data-cnh-tip-date></div>
        <div class="cnh-tip-val" data-cnh-tip-val></div>
        <div class="cnh-tip-cats" data-cnh-tip-cats></div>
      </div>
    </div>
    <p class="cnh-footnote muted" data-cnh-note></p>
  `;

  const $ = (s) => root.querySelector(s);
  const wrap = $('.cnh-canvas-wrap');
  const svg = $('.cnh-svg');
  const gridEl = $('.cnh-grid');
  const xAxisEl = $('.cnh-xaxis');
  const areaEl = $('.cnh-area');
  const totalEl = $('.cnh-total');
  const catsEl = $('.cnh-cats');
  const dotsEl = $('.cnh-dots');
  const clipEl = $('.cnh-clip');
  const endEl = $('.cnh-end');
  const endHalo = $('.cnh-end-halo');
  const endDot = $('.cnh-end-dot');
  const endLabel = $('.cnh-end-label');
  const crossEl = $('.cnh-cross');
  const hoverDotsEl = $('.cnh-hover-dots');
  const tipEl = $('[data-cnh-tip]');
  const tipDate = $('[data-cnh-tip-date]');
  const tipVal = $('[data-cnh-tip-val]');
  const tipCats = $('[data-cnh-tip-cats]');
  const metaEl = $('[data-cnh-meta]');
  const lastEl = $('[data-cnh-last]');
  const chgEl = $('[data-cnh-chg]');
  const legendEl = $('[data-cnh-legend]');
  const noteEl = $('[data-cnh-note]');
  const pills = [...root.querySelectorAll('.cnh-pill')];

  const padFor = () => ({
    t: 18,
    r: W < 420 ? 14 : 22,
    b: 30,
    l: W < 420 ? 38 : 48,
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
    hoverDotsEl.innerHTML = '';
    tipEl.hidden = true;
    endLabel.style.opacity = '';
  }

  function buildLegend() {
    const items = [
      `<span class="cnh-leg-item"><i class="cnh-leg-swatch cnh-leg-total" style="background:${TOTAL_COLOR}"></i>总额</span>`,
      ...catKeys.map(
        (k) =>
          `<span class="cnh-leg-item"><i class="cnh-leg-swatch" style="background:${catColor(k)}"></i>${k}</span>`
      ),
    ];
    legendEl.innerHTML = items.join('');
  }

  function paint() {
    hideHover();
    catKeys = collectCatKeys(slice.length ? slice : points);
    buildLegend();

    if (!slice.length) {
      gridEl.innerHTML = xAxisEl.innerHTML = '';
      catsEl.innerHTML = '';
      dotsEl.innerHTML = '';
      totalEl.setAttribute('d', '');
      areaEl.setAttribute('d', '');
      endEl.setAttribute('hidden', '');
      return;
    }

    const pad = padFor();
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const allVals = [];
    for (const p of slice) {
      allVals.push(p.total_wan);
      for (const k of catKeys) {
        const v = Number(p.categories[k]);
        if (Number.isFinite(v)) allVals.push(v);
      }
    }
    const sc = yScale(allVals);
    const n = slice.length;
    const px = (i) => pad.l + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
    const py = (v) => pad.t + (1 - (v - sc.min) / (sc.max - sc.min || 1)) * innerH;

    const totalPts = slice.map((p, i) => [px(i), py(p.total_wan)]);
    const catPts = {};
    for (const k of catKeys) {
      catPts[k] = slice.map((p, i) => {
        const v = Number(p.categories[k]);
        return [px(i), py(Number.isFinite(v) ? v : sc.min)];
      });
    }
    geo = { pad, innerW, innerH, px, py, totalPts, catPts, sc };

    const line = monotonePath(totalPts);
    const base = (H - pad.b).toFixed(2);
    totalEl.setAttribute('d', line);
    areaEl.setAttribute(
      'd',
      n > 1
        ? `${line} L ${totalPts[n - 1][0].toFixed(2)} ${base} L ${totalPts[0][0].toFixed(2)} ${base} Z`
        : ''
    );

    // category lines (thinner)
    catsEl.innerHTML = '';
    for (const k of catKeys) {
      const path = el('path', {
        class: 'cnh-cat-line',
        fill: 'none',
        stroke: catColor(k),
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        d: monotonePath(catPts[k]),
        'data-cat': k,
      });
      catsEl.appendChild(path);
    }

    // visible dots when few points (helps 1–2 point charts)
    dotsEl.innerHTML = '';
    if (n <= 4) {
      for (const [ex, ey] of totalPts) {
        dotsEl.appendChild(
          el('circle', {
            class: 'cnh-pt-total',
            cx: ex.toFixed(1),
            cy: ey.toFixed(1),
            r: 3.5,
            fill: '#FFD24A',
            stroke: 'var(--panel)',
            'stroke-width': '2',
          })
        );
      }
      for (const k of catKeys) {
        for (const [cx, cy] of catPts[k]) {
          dotsEl.appendChild(
            el('circle', {
              class: 'cnh-pt-cat',
              cx: cx.toFixed(1),
              cy: cy.toFixed(1),
              r: 2.4,
              fill: catColor(k),
              stroke: 'var(--panel)',
              'stroke-width': '1.5',
            })
          );
        }
      }
    }

    gridEl.innerHTML = sc.ticks
      .map((v) => {
        const y = py(v).toFixed(1);
        return (
          `<line class="cnh-grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>` +
          `<text class="cnh-y-label" x="${pad.l - 8}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end">${fmtAxisY(v, sc.step)}</text>`
        );
      })
      .join('');

    const ticks = pickAxisTicks(n, W < 420 ? 4 : n <= 7 ? n : 5);
    xAxisEl.innerHTML = ticks
      .map((i) => {
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        const x = i === 0 ? px(i) - 2 : i === n - 1 ? px(i) + 2 : px(i);
        return `<text class="cnh-x-label" x="${x.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${fmtAxisDate(slice[i].date)}</text>`;
      })
      .join('');

    const [ex, ey] = totalPts[n - 1];
    [endHalo, endDot].forEach((c) => {
      c.setAttribute('cx', ex.toFixed(1));
      c.setAttribute('cy', ey.toFixed(1));
    });
    endLabel.textContent = wan(slice[n - 1].total_wan) + ' 万';
    endLabel.setAttribute('x', (ex - 4).toFixed(1));
    endLabel.setAttribute('y', (ey - 14).toFixed(1));
    endLabel.setAttribute('text-anchor', 'end');
    endEl.removeAttribute('hidden');

    const first = slice[0].total_wan;
    const last = slice[n - 1].total_wan;
    const delta = last - first;
    const chg = first ? (delta / first) * 100 : null;
    lastEl.textContent = wan(last) + ' 万';
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    chgEl.innerHTML =
      n <= 1
        ? '—'
        : `${sign}${wan(Math.abs(delta))} 万 <small>${sign}${Math.abs(chg).toFixed(2)}%</small>`;
    chgEl.className = 'val ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
    metaEl.textContent =
      n <= 1
        ? `${slice[0].date} · 1 周`
        : `${slice[0].date} → ${slice[n - 1].date} · ${n} 周`;

    noteEl.textContent =
      n < 3
        ? '数据刚起步，每周更新后曲线会逐渐拉长 · 单位：万元 · #NFA'
        : '周度配置快照 · 单位：万元 · #NFA';
  }

  function draw(progress) {
    clipEl.setAttribute('x', '0');
    clipEl.setAttribute('width', String((W * progress).toFixed(1)));
    const done = progress >= 1;
    endEl.style.opacity = done ? '1' : '0';
    endEl.classList.toggle('on', done);
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
      const k = Math.max(0, Math.min(1, (now - t0) / DRAW_MS));
      draw(easeOutCubic(k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function setRange(key, animate = true) {
    range = RANGES[key] ? key : 'all';
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
    const [cx] = geo.totalPts[i];
    const cy = geo.totalPts[i][1];

    crossEl.removeAttribute('hidden');
    crossEl.setAttribute('x1', cx.toFixed(1));
    crossEl.setAttribute('x2', cx.toFixed(1));
    crossEl.setAttribute('y1', String(geo.pad.t));
    crossEl.setAttribute('y2', String(H - geo.pad.b));
    endLabel.style.opacity = '0';

    hoverDotsEl.innerHTML = '';
    hoverDotsEl.appendChild(
      el('circle', {
        cx: cx.toFixed(1),
        cy: cy.toFixed(1),
        r: 4.5,
        fill: '#FFD24A',
        stroke: 'var(--panel)',
        'stroke-width': '2',
        class: 'cnh-hover-dot',
      })
    );
    for (const k of catKeys) {
      const pt = geo.catPts[k] && geo.catPts[k][i];
      if (!pt) continue;
      hoverDotsEl.appendChild(
        el('circle', {
          cx: pt[0].toFixed(1),
          cy: pt[1].toFixed(1),
          r: 3.2,
          fill: catColor(k),
          stroke: 'var(--panel)',
          'stroke-width': '1.5',
          class: 'cnh-hover-dot',
        })
      );
    }

    tipDate.textContent = p.date;
    tipVal.textContent = wan(p.total_wan) + ' 万';
    tipCats.innerHTML = catKeys
      .map((k) => {
        const v = Number(p.categories[k]);
        return `<div class="cnh-tip-row"><span><i class="cnh-leg-swatch" style="background:${catColor(k)}"></i>${k}</span><b>${Number.isFinite(v) ? wan(v) + ' 万' : '—'}</b></div>`;
      })
      .join('');
    tipEl.hidden = false;

    const tw = tipEl.offsetWidth || 160;
    let left = cx + 14;
    if (left + tw > W - 4) left = cx - 14 - tw;
    left = Math.max(4, left);
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${Math.max(4, geo.pad.t - 4)}px`;
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

  setRange(showRange ? defaultRange : 'all', true);
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
  };
}

export async function initCnFundChart(el) {
  if (!el) return null;
  try {
    const res = await fetch('/data/cn-fund-history.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('cn-fund-history.json ' + res.status);
    const raw = await res.json();
    const points = normalizeHistory(raw);
    if (!points.length) {
      el.innerHTML = '<div class="cnh-empty muted">暂无周度序列（cn-fund-history.json）</div>';
      return null;
    }
    el.hidden = false;
    return mountCnFundChart(el, { points, defaultRange: 'all' });
  } catch (err) {
    console.warn('cn fund chart failed', err);
    el.hidden = false;
    el.innerHTML = '<div class="cnh-empty muted">周度走势暂时无法显示</div>';
    return null;
  }
}
