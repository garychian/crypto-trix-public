/**
 * Semicircle VIX fear gauge — loads /data/vix.json, animates needle on view.
 */
const MAX_VIX = 40;
const SEGMENTS = [
  { from: 0, to: 15, color: '#0ECB81', label: '低波' },
  { from: 15, to: 25, color: '#F0B90B', label: '中性' },
  { from: 25, to: 40, color: '#F6465D', label: '恐慌' },
];

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

function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  // Sweep from higher deg (left) to lower deg (right) → clockwise in SVG? 
  // Our angles decrease left→right; large-arc=0, sweep=1 for clockwise in screen coords
  // From 180→90: going clockwise through top? In SVG with y-down:
  // cos/sin with our polar: 180→(-r,0), 90→(0,-r), 0→(r,0) — that's counterclockwise visually along the upper arc.
  // For path A: sweep-flag 0 = CCW in SVG. We want upper semicircle left→right = CCW from 180 to 0.
  const large = Math.abs(startDeg - endDeg) > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
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
  // Overshoot ~10% of travel then rebound (springy ease via rAF)
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
  const cx = 160;
  const cy = 150;
  const r = 118;
  const stroke = 18;

  const arcs = SEGMENTS.map((seg) => {
    const start = valueToDeg(seg.from);
    const end = valueToDeg(seg.to);
    const d = arcPath(cx, cy, r, start, end);
    return `<path class="vix-arc" d="${d}" stroke="${seg.color}" stroke-width="${stroke}" fill="none" stroke-linecap="butt" />`;
  }).join('');

  // Tick marks at 0, 15, 25, 40
  const ticks = [0, 15, 25, 40]
    .map((v) => {
      const deg = valueToDeg(v);
      const outer = polar(cx, cy, r + stroke / 2 + 2, deg);
      const inner = polar(cx, cy, r - stroke / 2 - 6, deg);
      return `<line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" class="vix-tick" />`;
    })
    .join('');

  const tickLabels = [
    { v: 0, text: '0' },
    { v: 15, text: '15' },
    { v: 25, text: '25' },
    { v: 40, text: '40+' },
  ]
    .map(({ v, text }) => {
      const deg = valueToDeg(v);
      const p = polar(cx, cy, r - stroke / 2 - 18, deg);
      return `<text x="${p.x}" y="${p.y}" class="vix-tick-label" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
    })
    .join('');

  // Needle: pivot at cx,cy; default points left (180°) via transform-origin
  // We draw needle pointing UP (toward 90°) then rotate: rotate(180-deg) around pivot
  // At 0 VIX: deg=180, rotate(0) → need needle at left. So draw needle pointing left initially.
  const needleLen = r - 8;
  const needle = `
    <g class="vix-needle" transform="rotate(0 ${cx} ${cy})">
      <line x1="${cx}" y1="${cy}" x2="${cx - needleLen}" y2="${cy}" class="vix-needle-line" />
      <circle cx="${cx}" cy="${cy}" r="7" class="vix-needle-hub" />
      <circle cx="${cx}" cy="${cy}" r="3.5" class="vix-needle-hub-inner" />
    </g>`;

  return `
    <svg class="vix-svg" viewBox="0 0 320 175" role="img" aria-label="VIX fear gauge">
      <defs>
        <filter id="vix-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
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

  const cx = 160;
  const cy = 150;
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
      // small delay so layout paints first
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
