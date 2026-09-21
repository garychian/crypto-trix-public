/**
 * Semicircle VIX fear gauge — flashy gradient half-donut, glowing needle.
 */
const MAX_VIX = 40;
const ZONE_STOPS = [
  { v: 0, color: '#0ECB81' },
  { v: 15, color: '#0ECB81' },
  { v: 20, color: '#F0B90B' },
  { v: 25, color: '#F0B90B' },
  { v: 32, color: '#F6465D' },
  { v: 40, color: '#F6465D' },
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

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function lerpColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const r = Math.round(A.r + (B.r - A.r) * t);
  const g = Math.round(A.g + (B.g - A.g) * t);
  const bl = Math.round(A.b + (B.b - A.b) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Smooth color along VIX axis using zone stops. */
function colorAtValue(v) {
  const stops = ZONE_STOPS;
  if (v <= stops[0].v) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i].v) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (v - a.v) / (b.v - a.v || 1);
      return lerpColor(a.color, b.color, t);
    }
  }
  return stops[stops.length - 1].color;
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

function springNeedle(el, fromDeg, toDeg, cx, cy, durationMs = 1600) {
  // Stronger overshoot (~16% of travel) then rebound — still tasteful
  const travel = toDeg - fromDeg;
  const overshoot = travel * 0.16;
  const peak = toDeg + overshoot;
  const t0 = performance.now();

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeOutBack(t) {
    const c1 = 1.90158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function frame(now) {
    const t = Math.min(1, (now - t0) / durationMs);
    let deg;
    if (t < 0.68) {
      const u = easeOutCubic(t / 0.68);
      deg = fromDeg + (peak - fromDeg) * u;
    } else {
      const u = Math.min(1, Math.max(0, easeOutBack((t - 0.68) / 0.32)));
      deg = peak + (toDeg - peak) * u;
    }
    setNeedleAngle(el, deg, cx, cy);
    if (t < 1) requestAnimationFrame(frame);
    else {
      setNeedleAngle(el, toDeg, cx, cy);
      el.classList.add('is-settled');
    }
  }
  requestAnimationFrame(frame);
}

function buildGaugeSVG() {
  const cx = CX;
  const cy = CY;
  const rO = R_OUTER;
  const rI = R_INNER;
  const rMid = (rO + rI) / 2;
  const uid = 'vixg';

  // Dark rail (inner track) behind the active band
  const rail = annularSegment(cx, cy, rO + 3, rI - 3, 180, 0);

  // Smooth gradient band: many thin annular slices with tiny overlap (no seams)
  const SLICES = 64;
  const slices = [];
  const overlap = MAX_VIX / SLICES * 0.35;
  for (let i = 0; i < SLICES; i++) {
    const v0 = Math.max(0, (i / SLICES) * MAX_VIX - (i === 0 ? 0 : overlap));
    const v1 = Math.min(MAX_VIX, ((i + 1) / SLICES) * MAX_VIX + (i === SLICES - 1 ? 0 : overlap));
    const start = valueToDeg(v0);
    const end = valueToDeg(v1);
    const color = colorAtValue(((i + 0.5) / SLICES) * MAX_VIX);
    const d = annularSegment(cx, cy, rO, rI, start, end);
    slices.push(
      `<path class="vix-arc-slice" d="${d}" fill="${color}" stroke="${color}" stroke-width="0.6" stroke-linejoin="round" />`
    );
  }

  // Soft outer glow layer (slightly larger, low opacity duplicate)
  const glowBand = annularSegment(cx, cy, rO + 6, rO - 2, 180, 0);

  // Gradient defs for glow + needle
  const defs = `
    <defs>
      <linearGradient id="${uid}-band" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#0ECB81"/>
        <stop offset="37.5%" stop-color="#0ECB81"/>
        <stop offset="50%" stop-color="#F0B90B"/>
        <stop offset="62.5%" stop-color="#F0B90B"/>
        <stop offset="80%" stop-color="#F6465D"/>
        <stop offset="100%" stop-color="#F6465D"/>
      </linearGradient>
      <radialGradient id="${uid}-hub" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FFF6D0"/>
        <stop offset="45%" stop-color="#F0B90B"/>
        <stop offset="100%" stop-color="#B8860B"/>
      </radialGradient>
      <filter id="${uid}-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="b"/>
        <feMerge>
          <feMergeNode in="b"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="${uid}-needle" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="b"/>
        <feColorMatrix in="b" type="matrix"
          values="1 0.8 0.2 0 0
                  0.7 0.6 0.1 0 0
                  0.2 0.15 0.05 0 0
                  0 0 0 0.95 0" result="glow"/>
        <feMerge>
          <feMergeNode in="glow"/>
          <feMergeNode in="glow"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="${uid}-hub-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/>
        <feMerge>
          <feMergeNode in="b"/>
          <feMergeNode in="b"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <linearGradient id="${uid}-needle-fill" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#FFF8E0"/>
        <stop offset="55%" stop-color="#F0B90B"/>
        <stop offset="100%" stop-color="#FFE566"/>
      </linearGradient>
    </defs>`;

  // Tick marks at segment boundaries (radial, across the ring)
  const ticks = [0, 15, 25, 40]
    .map((v) => {
      const deg = valueToDeg(v);
      const outer = polar(cx, cy, rO + 2, deg);
      const inner = polar(cx, cy, rI - 4, deg);
      return `<line x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}" class="vix-tick" />`;
    })
    .join('');

  // Labels just outside the outer radius
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
      if (v === 0) {
        x += 4;
        y -= 2;
      }
      if (v === 40) {
        x -= 6;
        y -= 2;
      }
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="vix-tick-label" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
    })
    .join('');

  // Needle: sharp tip + glow, drawn pointing left (180°)
  const tipX = cx - (rMid - 2);
  const baseX = cx - 10;
  const needle = `
    <g class="vix-needle" transform="rotate(0 ${cx} ${cy})">
      <polygon
        class="vix-needle-blade"
        points="${tipX},${cy} ${baseX},${cy - 3.2} ${baseX},${cy + 3.2}"
        filter="url(#${uid}-needle)"
      />
      <line
        class="vix-needle-core"
        x1="${cx - 8}" y1="${cy}" x2="${tipX + 4}" y2="${cy}"
      />
      <circle cx="${cx}" cy="${cy}" r="11" class="vix-needle-hub-halo" filter="url(#${uid}-hub-glow)" />
      <circle cx="${cx}" cy="${cy}" r="8" class="vix-needle-hub" fill="url(#${uid}-hub)" />
      <circle cx="${cx}" cy="${cy}" r="3.2" class="vix-needle-hub-inner" />
    </g>`;

  return `
    <svg class="vix-svg" viewBox="-8 -8 ${VIEW_W + 16} ${VIEW_H + 8}" role="img" aria-label="VIX fear gauge">
      ${defs}
      <g class="vix-band-group">
        <path class="vix-rail" d="${rail}" />
        <path class="vix-glow-band" d="${glowBand}" fill="url(#${uid}-band)" filter="url(#${uid}-glow)" />
        <g class="vix-arc-band">${slices.join('')}</g>
      </g>
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
  const band = root.querySelector('.vix-band-group');
  if (!needle || !Number.isFinite(value)) return;

  const cx = CX;
  const cy = CY;
  const targetDeg = valueToDeg(value);
  setNeedleAngle(needle, 180, cx, cy);

  let played = false;
  function play() {
    if (played) return;
    played = true;
    if (band) band.classList.add('is-lit');
    springNeedle(needle, 180, targetDeg, cx, cy, 1600);
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
