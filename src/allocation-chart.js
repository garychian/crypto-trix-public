/**
 * 仓位分布 donut for 财富自由基金 tab.
 * Pure SVG, no dependency. Slices = top holdings + 其他 (long tail) + 现金.
 * Values come from the same mvOf()/cash numbers the page totals use.
 *
 * Shared by fund.html (USD, defaults) and cn-fund.html (CNY) — pass `opts`
 * to renderAllocation() to change title / center labels / number formats.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_NAMED = 6; // named holdings before the rest collapse into 其他
const ANIM_MS = 700;
const CX = 100;
const CY = 100;
const R = 76;
const SW = 26;
const GAP_DEG = 1.1;

// first 9 unchanged (cn-fund); extra hues so ~14 stocks stay distinguishable
const PALETTE = ['#F0B90B', '#4C8DF7', '#0ECB81', '#A06BFF', '#22C7D6', '#FF8A3D', '#E573B5', '#8FD14F', '#C9A27A', '#5B5FEF', '#FF6B6B', '#2E9E8F', '#D9D26A', '#9BB7D4', '#B07A5B', '#7FE0B5'];
const OTHER_COLOR = '#E573B5';
const CASH_COLOR = '#A7B0BD';

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function money(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Round shares to 1 decimal so the displayed percentages add up to exactly 100.0 */
function roundedPcts(values) {
  const total = values.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 1000);
  const floor = raw.map(Math.floor);
  let rest = 1000 - floor.reduce((s, v) => s + v, 0);
  raw
    .map((v, i) => ({ i, f: v - floor[i] }))
    .sort((a, b) => b.f - a.f)
    .forEach(({ i }) => {
      if (rest > 0) {
        floor[i] += 1;
        rest -= 1;
      }
    });
  return floor.map((v) => v / 10);
}

/** Build slice list from holdings [{label, value}] + cash. Exported for testing. */
export function buildSlices(items, cash, maxNamed = MAX_NAMED) {
  const rows = (items || [])
    .filter((x) => x && Number.isFinite(x.value) && x.value > 0)
    .sort((a, b) => b.value - a.value);
  let named = rows;
  let tail = [];
  // group the long tail once there are more than maxNamed+1 holdings
  if (rows.length > maxNamed + 1) {
    named = rows.slice(0, maxNamed);
    tail = rows.slice(maxNamed);
  }
  const slices = named.map((r, i) => ({
    name: r.label,
    value: r.value,
    color: PALETTE[i % PALETTE.length],
    kind: 'holding',
    sub: r.sub || '',
  }));
  if (tail.length) {
    slices.push({
      name: '其他',
      value: tail.reduce((s, r) => s + r.value, 0),
      color: OTHER_COLOR,
      kind: 'other',
      detail: tail.map((r) => r.label).join(' · '),
      count: tail.length,
    });
  }
  if (Number.isFinite(cash) && cash > 0) {
    slices.push({ name: '现金', value: cash, color: CASH_COLOR, kind: 'cash' });
  }
  const total = slices.reduce((s, x) => s + x.value, 0);
  const pcts = roundedPcts(slices.map((s) => s.value));
  slices.forEach((s, i) => {
    s.pct = pcts[i];
    s.frac = total > 0 ? s.value / total : 0;
  });
  return { slices, total };
}

function arcPath(a0, a1) {
  // angles in degrees, 0 = 12 o'clock, clockwise
  const span = Math.min(a1 - a0, 359.99);
  const rad = (d) => ((d - 90) * Math.PI) / 180;
  const x0 = CX + R * Math.cos(rad(a0));
  const y0 = CY + R * Math.sin(rad(a0));
  const x1 = CX + R * Math.cos(rad(a0 + span));
  const y1 = CY + R * Math.sin(rad(a0 + span));
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${span > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * @param {HTMLElement|null} el  container (the panel)
 * @param {{items:{label:string,value:number}[], cash:number|null, asOf?:string|null}} data
 */
export function renderAllocation(el, data, opts = {}) {
  if (!el) return;
  const o = {
    title: '仓位分布 Allocation',
    meta: (n) => '持仓 ' + n + ' 只 + 现金',
    centerLabel: '总资产',
    centerSub: '持仓 + 现金',
    maxNamed: MAX_NAMED,
    twoColFrom: Infinity, // legend switches to 2 columns (desktop) at this many rows
    fmtLegend: money, // legend $ column
    fmtCenter: money, // donut center total
    fmtHover: money, // hover 3rd line
    ...opts,
  };
  try {
    const { slices, total } = buildSlices(data && data.items, data && data.cash, o.maxNamed);
    if (!slices.length || !(total > 0)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const holdingN = (data.items || []).length;

    el.innerHTML =
      '<div class="panel-head">' +
      '<h2 id="alloc-title">' + esc(o.title) + '</h2>' +
      '<span class="muted">' + esc(o.meta(holdingN)) + '</span>' +
      '</div>' +
      '<div class="alloc-body">' +
      '<div class="alloc-donut">' +
      '<svg viewBox="0 0 200 200" role="img" aria-label="持仓与现金占比环形图"></svg>' +
      '<div class="alloc-center" aria-live="polite">' +
      '<span class="ac-k"></span><span class="ac-v"></span><span class="ac-s"></span>' +
      '</div></div>' +
      '<ul class="alloc-legend' + (slices.length >= o.twoColFrom ? ' cols2' : '') + '" style="--rows:' + Math.ceil(slices.length / 2) + '">' +
      slices
        .map(
          (s, i) =>
            '<li class="alloc-row" data-i="' + i + '" tabindex="0"' +
            (s.detail ? ' title="' + esc(s.detail) + '"' : '') + '>' +
            '<span class="al-dot" style="background:' + s.color + '"></span>' +
            '<span class="al-name">' + esc(s.name) +
            (s.kind === 'other'
              ? '<small>' + s.count + ' 只</small>'
              : s.sub
                ? '<small>' + esc(s.sub) + '</small>'
                : '') +
            '</span>' +
            '<span class="al-val">' + esc(o.fmtLegend(s.value)) + '</span>' +
            '<span class="al-pct">' + s.pct.toFixed(1) + '%</span>' +
            '</li>'
        )
        .join('') +
      '</ul></div>';

    const svg = el.querySelector('svg');
    const ck = el.querySelector('.ac-k');
    const cv = el.querySelector('.ac-v');
    const cs = el.querySelector('.ac-s');
    const rows = [...el.querySelectorAll('.alloc-row')];

    const track = document.createElementNS(SVG_NS, 'circle');
    track.setAttribute('cx', CX);
    track.setAttribute('cy', CY);
    track.setAttribute('r', R);
    track.setAttribute('class', 'alloc-track');
    svg.appendChild(track);

    // angular layout
    const multi = slices.length > 1;
    let cursor = 0;
    const paths = slices.map((s, i) => {
      const span = s.frac * 360;
      const g = multi ? Math.min(GAP_DEG, span / 3) : 0;
      s._a0 = cursor + g / 2;
      s._a1 = cursor + span - g / 2;
      // keep tiny slices visible: minimum arc ~1.6°, centred on the slice
      if (s._a1 - s._a0 < 1.6) {
        const mid = (s._a0 + s._a1) / 2;
        s._a0 = mid - 0.8;
        s._a1 = mid + 0.8;
      }
      cursor += span;
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', 'alloc-slice');
      p.setAttribute('stroke', s.color);
      p.setAttribute('stroke-width', SW);
      p.setAttribute('fill', 'none');
      p.setAttribute('tabindex', '0');
      p.setAttribute(
        'aria-label',
        s.name + ' ' + s.pct.toFixed(1) + '% ' + o.fmtHover(s.value)
      );
      p.dataset.i = String(i);
      svg.appendChild(p);
      return p;
    });

    const draw = (t) => {
      slices.forEach((s, i) => {
        const a0 = s._a0 * t;
        const a1 = s._a1 * t;
        if (a1 - a0 < 0.05) paths[i].removeAttribute('d');
        else paths[i].setAttribute('d', arcPath(a0, a1));
      });
    };

    const showTotal = () => {
      ck.textContent = o.centerLabel;
      cv.textContent = o.fmtCenter(total);
      cs.textContent = o.centerSub;
      cv.style.color = '';
    };
    const showSlice = (i) => {
      const s = slices[i];
      ck.textContent = s.name;
      cv.textContent = s.pct.toFixed(1) + '%';
      cs.textContent = o.fmtHover(s.value);
      cv.style.color = s.color;
    };

    let active = -1;
    const setActive = (i) => {
      if (i === active) return;
      active = i;
      el.classList.toggle('has-active', i >= 0);
      paths.forEach((p, k) => p.classList.toggle('active', k === i));
      rows.forEach((r, k) => r.classList.toggle('active', k === i));
      if (i >= 0) showSlice(i);
      else showTotal();
    };

    [...paths, ...rows].forEach((node) => {
      const i = Number(node.dataset.i);
      node.addEventListener('mouseenter', () => setActive(i));
      node.addEventListener('mouseleave', () => setActive(-1));
      node.addEventListener('focus', () => setActive(i));
      node.addEventListener('blur', () => setActive(-1));
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        setActive(active === i ? -1 : i); // tap toggles on touch devices
      });
    });
    document.addEventListener('click', () => setActive(-1));

    showTotal();

    const reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame !== 'function') {
      draw(1);
    } else {
      draw(0);
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.max(0, Math.min(1, (now - t0) / ANIM_MS)); // rAF ts can precede t0
        draw(easeOutCubic(k));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  } catch (err) {
    el.hidden = true;
    console.warn('allocation chart failed', err);
  }
}
