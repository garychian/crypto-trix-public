/**
 * Apple Activity–style concentric journey progress rings.
 * Outer: total / goal → $2M
 * Middle: current return / 2026 annual target (default 20%)
 * Inner: cash / total (现金占比) when available
 */
import { usd, escapeHTML } from './lib/format.js';

const SIZE = 280;
const CX = SIZE / 2;
const CY = SIZE / 2;

const RING_DEFS = [
  {
    key: 'progress',
    r: 116,
    stroke: 16,
    color: '#F0B90B',
    overfill: '#9A7608',
    glow: 'rgba(240, 185, 11, 0.55)',
    label: '旅程进度',
  },
  {
    key: 'return',
    r: 94,
    stroke: 14,
    color: '#0ECB81',
    overfill: '#0A8F5A',
    glow: 'rgba(14, 203, 129, 0.45)',
    label: '年度目标',
  },
  {
    key: 'cash',
    r: 74,
    stroke: 12,
    color: '#5B8CFF',
    overfill: '#3A5FBF',
    glow: 'rgba(91, 140, 255, 0.4)',
    label: '现金占比',
  },
];

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** Slight overshoot then settle — matches VIX spring feel. */
function easeOutBackSoft(t) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function ringEase(t) {
  if (t < 0.72) return easeOutCubic(t / 0.72) * 1.06;
  const u = (t - 0.72) / 0.28;
  const over = 1.06;
  return over + (1 - over) * easeOutBackSoft(u);
}

function circumference(r) {
  return 2 * Math.PI * r;
}

/**
 * Build metrics from holdings payload. Only include rings with real data.
 * @returns {{ rings: Array, total: number, goal: number, progress: number, asOf: string|null }}
 */
export function buildJourneyMetrics(data) {
  const total =
    data.total_assets_usd != null && Number.isFinite(Number(data.total_assets_usd))
      ? Number(data.total_assets_usd)
      : null;
  const goal = Number(data.goal_usd) || 2_000_000;
  const progress = total != null && goal > 0 ? total / goal : 0;

  const rings = [];

  // Outer — always (journey)
  rings.push({
    ...RING_DEFS[0],
    value: progress,
    displayPct: progress * 100,
    legend: '旅程 · → $2M',
  });

  // Middle — progress toward 2026 annual return target (default 20%)
  // Prefer explicit annualized_return_pct from holdings.json (user-stated YTD/annualized).
  const yearTargetPct =
    data.annual_return_target_pct != null && Number.isFinite(Number(data.annual_return_target_pct))
      ? Number(data.annual_return_target_pct)
      : 20;
  const yearLabel = data.annual_return_year != null ? String(data.annual_return_year) : '2026';
  let retPct = null;
  if (data.annualized_return_pct != null && Number.isFinite(Number(data.annualized_return_pct))) {
    retPct = Number(data.annualized_return_pct);
  } else {
    const invested = data.invested_usd != null ? Number(data.invested_usd) : null;
    const cumPnl = data.cum_pnl_usd != null ? Number(data.cum_pnl_usd) : null;
    if (invested != null && invested > 0 && cumPnl != null && Number.isFinite(cumPnl)) {
      retPct = (cumPnl / invested) * 100;
    }
  }
  if (retPct != null && yearTargetPct > 0) {
    const toward = retPct / yearTargetPct; // 1.0 = hit annual target
    rings.push({
      ...RING_DEFS[1],
      value: toward,
      displayPct: retPct,
      legend: yearLabel + ' 年化 · 目标' + yearTargetPct + '%',
      displayExtra: retPct.toFixed(2) + '% / ' + yearTargetPct + '%',
    });
  }

  // Inner — cash weight
  const cash = data.cash_usd != null ? Number(data.cash_usd) : null;
  if (cash != null && total != null && total > 0 && Number.isFinite(cash)) {
    const cashW = cash / total;
    rings.push({
      ...RING_DEFS[2],
      value: cashW,
      displayPct: cashW * 100,
      legend: '现金占比',
    });
  }

  return {
    rings,
    total: total ?? 0,
    goal,
    progress,
    asOf: data.as_of || null,
  };
}

function buildRingSVG(rings) {
  const uid = 'jr';
  const defs = `
    <defs>
      <filter id="${uid}-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"/>
        <feMerge>
          <feMergeNode in="b"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>`;

  const tracks = rings
    .map((ring) => {
      const c = circumference(ring.r);
      return `
        <circle
          class="jr-track"
          cx="${CX}" cy="${CY}" r="${ring.r}"
          fill="none"
          stroke="rgba(232,235,240,0.07)"
          stroke-width="${ring.stroke}"
          stroke-linecap="round"
        />
        <circle
          class="jr-progress"
          data-key="${ring.key}"
          cx="${CX}" cy="${CY}" r="${ring.r}"
          fill="none"
          stroke="${ring.color}"
          stroke-width="${ring.stroke}"
          stroke-linecap="round"
          stroke-dasharray="${c}"
          stroke-dashoffset="${c}"
          transform="rotate(-90 ${CX} ${CY})"
          filter="url(#${uid}-glow)"
          style="--jr-c:${c};--jr-glow:${ring.glow}"
        />
        <circle
          class="jr-overfill"
          data-key="${ring.key}"
          cx="${CX}" cy="${CY}" r="${ring.r}"
          fill="none"
          stroke="${ring.overfill}"
          stroke-width="${ring.stroke}"
          stroke-linecap="round"
          stroke-dasharray="${c}"
          stroke-dashoffset="${c}"
          transform="rotate(-90 ${CX} ${CY})"
          opacity="0"
        />`;
    })
    .join('');

  return `
    <svg class="jr-svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="财富自由旅程进度环">
      ${defs}
      <g class="jr-rings">${tracks}</g>
    </svg>`;
}

function setRingOffset(el, fraction, circumference) {
  const f = clamp01(fraction);
  el.setAttribute('stroke-dashoffset', String(circumference * (1 - f)));
}

function animateRings(root, rings, durationMs = 1600) {
  const t0 = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - t0) / durationMs);
    const e = ringEase(t);

    for (const ring of rings) {
      const c = circumference(ring.r);
      const progEl = root.querySelector(`.jr-progress[data-key="${ring.key}"]`);
      const overEl = root.querySelector(`.jr-overfill[data-key="${ring.key}"]`);
      if (!progEl) continue;

      const target = Math.max(0, ring.value);
      const firstLap = Math.min(1, target);
      const excess = Math.max(0, target - 1);

      // Animate first lap (with ease that can briefly overshoot past 1 visually, then clamp)
      const animFirst = Math.min(1.08, firstLap * e);
      setRingOffset(progEl, Math.min(1, animFirst), c);

      if (overEl) {
        if (excess > 0 && t > 0.55) {
          const overT = Math.min(1, (t - 0.55) / 0.45);
          const overE = easeOutCubic(overT);
          const overFrac = Math.min(1, excess) * overE;
          overEl.style.opacity = '1';
          setRingOffset(overEl, overFrac, c);
        } else if (excess <= 0) {
          overEl.style.opacity = '0';
          setRingOffset(overEl, 0, c);
        }
      }
    }

    if (t < 1) requestAnimationFrame(frame);
    else {
      // Settle exact final values
      for (const ring of rings) {
        const c = circumference(ring.r);
        const progEl = root.querySelector(`.jr-progress[data-key="${ring.key}"]`);
        const overEl = root.querySelector(`.jr-overfill[data-key="${ring.key}"]`);
        if (progEl) setRingOffset(progEl, Math.min(1, ring.value), c);
        if (overEl) {
          const excess = Math.max(0, ring.value - 1);
          if (excess > 0) {
            overEl.style.opacity = '1';
            setRingOffset(overEl, Math.min(1, excess), c);
          }
        }
      }
    }
  }
  requestAnimationFrame(frame);
}

function animateCountUp(el, from, to, durationMs, formatter) {
  const t0 = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - t0) / durationMs);
    const e = easeOutCubic(t);
    const v = from + (to - from) * e;
    el.textContent = formatter(v);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = formatter(to);
  }
  requestAnimationFrame(frame);
}

/**
 * @param {object} data — holdings payload from loadHoldingsData()
 */
export function renderJourneyRings(data) {
  const root = document.getElementById('journey-rings');
  if (!root) return;

  const metrics = buildJourneyMetrics(data);
  const { rings, total, goal, progress, asOf } = metrics;
  // Three progress figures in ring center — colors match the three rings
  const numStats = rings.map((r) => ({
    key: r.key,
    color: r.color,
    glow: r.glow,
    to: (Number(r.value) || 0) * 100,
  }));

  const legend = rings
    .map(
      (r) => `
      <div class="jr-leg-item">
        <span class="jr-dot" style="background:${r.color};box-shadow:0 0 8px ${r.glow}"></span>
        <span class="jr-leg-label">${escapeHTML(r.legend)}</span>
        <span class="jr-leg-val">${r.displayExtra ? escapeHTML(r.displayExtra) : r.displayPct.toFixed(2) + '%'}</span>
      </div>`
    )
    .join('');

  root.innerHTML = `
    <div class="jr-card-inner">
      <div class="jr-head">
        <div class="en">Wealth Freedom · Journey</div>
        <h2 id="journey-title">财富自由 · 旅程进度</h2>
        <p class="jr-sub muted">$137K → $2M · Activity Rings</p>
      </div>
      <div class="jr-body">
        <div class="jr-visual">
          ${buildRingSVG(rings)}
          <div class="jr-center jr-center-nums">
            <div class="jr-nums" id="jr-nums">
              ${numStats
                .map(
                  (n) => `
                <div class="jr-num" data-key="${n.key}" style="color:${n.color};text-shadow:0 0 14px ${n.glow}">
                  <span class="jr-num-val" data-key="${n.key}">0%</span>
                </div>`
                )
                .join('')}
            </div>
          </div>
        </div>
        <div class="jr-side">
          <div class="jr-legend">${legend}</div>
          <div class="jr-nfa muted">#NFA · 非投资建议</div>
        </div>
      </div>
    </div>
  `;

  let played = false;
  function play() {
    if (played) return;
    played = true;
    root.classList.add('is-lit');
    animateRings(root, rings, 1650);
    for (const n of numStats) {
      const el = root.querySelector('.jr-num-val[data-key="' + n.key + '"]');
      if (el) {
        animateCountUp(el, 0, n.to, 1650, (v) => v.toFixed(2) + '%');
      }
    }
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

  requestAnimationFrame(() => {
    const rect = root.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setTimeout(play, 100);
    }
  });
}
