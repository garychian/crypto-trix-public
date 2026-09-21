/**
 * Semicircle VIX fear gauge — thick annular ring (half-donut), needle on view.
 */
const MAX_VIX = 40;
const SEGMENTS = [
  { from: 0, to: 15, color: '#0ECB81', label: '低波' },
  { from: 15, to: 25, color: '#F0B90B', label: '中性' },
  { from: 25, to: 40, color: '#F6465D', label: '恐慌' },
];

// Geometry (shared by SVG build + needle)
const CX = 160;
const CY = 152;
const R_OUTER = 128;
const R_INNER = 92;
const VIEW_W = 320;
const VIEW_H = 186;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Map VIX value → degrees: 0 → 180° (left), MAX → 0° (right). */
function valueToDeg(value, max = MAX_VIX) {
  const t = clamp(value, 0, max) / max;
  return 180 - t * 180;
}

/** Polar to cartesian; SVG y grows down. Angle: 180=left, 90=top, 0=right. */
function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  };
}

/**
 * Closed annular sector path (filled ring slice).
 * In SVG (y-down), clockwise sweep=1 from left(180°)→right(0°) travels along the TOP.
 * Outer: start→end along top (sweep 1); inner: end→start along top (sweep 0).
 */
function annularSegment(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const oS = polar(cx, cy, rOuter, startDeg);
  const oE = polar(cx, cy, rOuter, endDeg);
  const iS = polar(cx, cy, rInner, startDeg);
  const iE = polar(cx, cy, rInner, endDeg);
  const large = Math.abs(startDeg - endDeg) > 180 ? 1 : 0;
  return [
    `M ${oS.x.toFixed(3)} ${oS.y.toFixed(3)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${oE.x.toFixed(3)} ${oE.y.toFixed(3)}`,
    `L ${iE.x.toFixed(3)} ${iE.y.toFixed(3)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${iS.x.toFixed(3)} ${iS.y.toFixed(3)}`,
    'Z',
  ].join(' ');
}

function formatChg(chg, chgPct) {
  const sign = chg > 0 ? '+' : chg < 0 ? '−' : '';
  const abs = Math.abs(chg).toFixed(2);
  const pctSign = chgPct > 0 ? '+' : chgPct < 0 ? '−' : '';
  const pctAbs = Math.abs(chgPct).toFixed(2);
  return `${sign}${abs}  (${pctSign}${pctAbs}%)`;
}

function setNeedleAngle(el, valueDeg, cx, cy) {
  // Needle drawn pointing left (180°). Positive SVG rotate = clockwise toward higher VIX.
  const rot = 180 - valueDeg;
  el.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);
}

function springNeedle(el, fromDeg, toDeg, cx, cy, durationMs = 1400) {
  // Overshoot ~10% of travel then rebound
  const travel = toDeg - fromDeg;
  const overshoot = travel * 0.1;
  const peak = toDeg + overshoot;
  const t0 = performance.now();

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function frame(now) {
    const t = Math.min(1, (now - t0) / durationMs);
    let deg;
    if (t < 0.72) {
      const u = easeOutCubic(t / 0.72);
      deg = fromDeg + (peak - fromDeg) * u;
    } else {
      const u = Math.min(1, Math.max(0, easeOutBack((t - 0.72) / 0.28)));
      deg = peak + (toDeg - peak) * u;
    }
    setNeedleAngle(el, deg, cx, cy);
    if (t < 1) requestAnimationFrame(frame);
    else setNeedleAngle(el, toDeg, cx, cy);
  }
  requestAnimationFrame(frame);
}

function buildGaugeSVG() {
  const cx = CX;
  const cy = CY;
  const rO = R_OUTER;
  const rI = R_INNER;

  const arcs = SEGMENTS.map((seg) => {
    const start = valueToDeg(seg.from);
    const end = valueToDeg(seg.to);
    const d = annularSegment(cx, cy, rO, rI, start, end);
    return `<path class="vix-arc" d="${d}" fill="${seg.color}" stroke="none" />`;
  }).join('');

  // Tick marks at segment boundaries (radial, across the ring)
  const ticks = [0, 15, 25, 40]
    .map((v) => {
      const deg = valueToDeg(v);
      const outer = polar(cx, cy, rO + 2, deg);
      const inner = polar(cx, cy, rI - 4, deg);
      return `<line x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}" class="vix-tick" />`;
    })
    .join('');

  // Labels just outside the outer radius (clear of the center readout)
  const tickLabels = [
    { v: 0, text: '0' },
    { v: 15, text: '15' },
    { v: 25, text: '25' },
    { v: 40, text: '40+' },
  ]
    .map(({ v, text }) => {
      const deg = valueToDeg(v);
      const p = polar(cx, cy, rO + 16, deg);
      let x = p.x;
      let y = p.y;
      // Keep end labels from escaping the viewBox
      if (v === 0) { x += 4; y -= 2; }
      if (v === 40) { x -= 6; y -= 2; }
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="vix-tick-label" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
    })
    .join('');

  // Needle: drawn pointing left (180°); rotate clockwise as VIX rises
  const needleLen = (rO + rI) / 2 - 4;
  const needle = `
    <g class="vix-needle" transform="rotate(0 ${cx} ${cy})">
      <line x1="${cx}" y1="${cy}" x2="${cx - needleLen}" y2="${cy}" class="vix-needle-line" />
      <circle cx="${cx}" cy="${cy}" r="7" class="vix-needle-hub" />
      <circle cx="${cx}" cy="${cy}" r="3.5" class="vix-needle-hub-inner" />
    </g>`;

  return `
    <svg class="vix-svg" viewBox="-8 -8 ${VIEW_W + 16} ${VIEW_H + 8}" role="img" aria-label="VIX fear gauge">
      ${arcs}
      ${ticks}
      ${tickLabels}
      ${needle}
    </svg>`;
}

export async function renderVixGauge() {
  const root = document.getElementById('vix-gauge');
  if (!root) return;

  let data;
  try {
    const res = await fetch('/data/vix.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch {
    root.innerHTML = `<div class="vix-error muted">VIX 数据加载失败</div>`;
    return;
  }

  const value = Number(data.value);
  const chg = Number(data.chg);
  const chgPct = Number(data.chg_pct);
  const asOf = data.as_of || '—';
  const chgCls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
  const zone =
    value < 15 ? '冷静 · 低波' : value < 25 ? '升温 · 中性' : '恐慌';

  root.innerHTML = `
    <div class="vix-card-inner">
      <div class="vix-head">
        <div class="en">CBOE Volatility Index</div>
        <h2 id="vix-title">VIX · 恐惧指数</h2>
      </div>
      <div class="vix-body">
        <div class="vix-gauge-visual">
          ${buildGaugeSVG()}
          <div class="vix-readout">
            <div class="vix-value" id="vix-value">${Number.isFinite(value) ? value.toFixed(2) : '—'}</div>
            <div class="vix-label">VIX</div>
          </div>
        </div>
        <div class="vix-meta">
          <div class="vix-asof muted">as of ${escapeAttr(asOf)}</div>
          <div class="vix-chg ${chgCls}" id="vix-chg">${formatChg(chg, chgPct)}</div>
          <div class="vix-zone">${escapeAttr(zone)}</div>
          <div class="vix-seg-labels" aria-hidden="true">
            <span class="seg-g">低波</span>
            <span class="seg-a">中性</span>
            <span class="seg-r">恐慌</span>
          </div>
          <div class="vix-nfa muted">#NFA · 非投资建议</div>
        </div>
      </div>
    </div>
  `;

  const needle = root.querySelector('.vix-needle');
  if (!needle || !Number.isFinite(value)) return;

  const cx = CX;
  const cy = CY;
  const targetDeg = valueToDeg(value);
  setNeedleAngle(needle, 180, cx, cy);

  let played = false;
  function play() {
    if (played) return;
    played = true;
    springNeedle(needle, 180, targetDeg, cx, cy);
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          play();
          io.disconnect();
          break;
        }
      }
    },
    { threshold: 0.35 }
  );
  io.observe(root);

  // Fallback if already visible / IO unsupported
  requestAnimationFrame(() => {
    const rect = root.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setTimeout(play, 80);
    }
  });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
