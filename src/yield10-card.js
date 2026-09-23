/**
 * US 10Y Treasury yield card — big readout + 90-day sparkline.
 * Live first (serverless /api/yield10 → FRED), static /data/yield10.json fallback.
 */

async function loadYield10() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('/api/yield10', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const live = await res.json();
      if (Number.isFinite(Number(live.value))) return live;
    }
  } catch {
    /* fall through to snapshot */
  }
  const res = await fetch('/data/yield10.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function signed(n, digits = 2) {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return sign + Math.abs(v).toFixed(digits);
}

/** 90-day sparkline: gradient area + line + last-point dot, hi/lo faint labels. */
function sparkSVG(history) {
  const pts = (history || []).filter((p) => Number.isFinite(Number(p.v)));
  if (pts.length < 2) return '';
  const W = 300;
  const H = 84;
  const PAD_X = 6;
  const PAD_TOP = 14;
  const PAD_BOT = 16;
  const vs = pts.map((p) => Number(p.v));
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1e-9) {
    hi += 0.01;
    lo -= 0.01;
  }
  const x = (i) => PAD_X + (i / (pts.length - 1)) * (W - PAD_X * 2);
  const y = (v) => PAD_TOP + (1 - (v - lo) / (hi - lo)) * (H - PAD_TOP - PAD_BOT);
  const coords = pts.map((p, i) => `${x(i).toFixed(1)},${y(vs[i]).toFixed(1)}`);

  const lastX = x(pts.length - 1);
  const lastY = y(vs[vs.length - 1]);
  const hiIdx = vs.indexOf(hi);
  const loIdx = vs.indexOf(lo);

  const path = `M ${coords.join(' L ')}`;
  const area = `${path} L ${lastX.toFixed(1)},${H - 2} L ${x(0).toFixed(1)},${H - 2} Z`;

  const label = (i, v, cls) =>
    `<text x="${x(i).toFixed(1)}" y="${(cls === 'hi' ? y(v) - 4 : y(v) + 11).toFixed(1)}" class="y10-spark-extreme ${cls}" text-anchor="middle">${v.toFixed(2)}</text>`;

  return `
    <svg class="y10-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="美债十年期收益率 近90个交易日走势">
      <defs>
        <linearGradient id="y10-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(91,140,255,0.34)"/>
          <stop offset="100%" stop-color="rgba(91,140,255,0)"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#y10-area)"/>
      <path d="${path}" fill="none" class="y10-spark-line"/>
      ${hiIdx !== loIdx ? label(hiIdx, hi, 'hi') : ''}
      ${hiIdx !== loIdx ? label(loIdx, lo, 'lo') : ''}
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.4" class="y10-spark-dot"/>
    </svg>`;
}

export async function renderYield10Card() {
  const root = document.getElementById('yield10');
  if (!root) return;

  let data;
  try {
    data = await loadYield10();
  } catch {
    root.innerHTML = `<div class="y10-card-inner"><div class="y10-error muted">十年期美债数据加载失败</div></div>`;
    return;
  }

  const value = Number(data.value);
  const chg = Number(data.chg);
  const chgPct = Number(data.chg_pct);
  const asOf = data.as_of || '—';
  const chgCls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
  const arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '—';
  const lo90 = Number(data.lo_90d);
  const hi90 = Number(data.hi_90d);

  root.innerHTML = `
    <div class="y10-card-inner">
      <div class="y10-head">
        <div class="en">US 10Y Treasury</div>
        <h2 id="y10-title">美债十年期收益率</h2>
      </div>
      <div class="y10-body">
        <div class="y10-readout">
          <div class="y10-value-row">
            <span class="y10-value">${Number.isFinite(value) ? value.toFixed(2) : '—'}</span>
            <span class="y10-unit">%</span>
          </div>
          <div class="y10-chg ${chgCls}">${arrow} ${signed(chg)}（${signed(chgPct)}%）</div>
          <div class="y10-asof muted">as of ${asOf} · 日频</div>
        </div>
        <div class="y10-spark-wrap">
          ${sparkSVG(data.history)}
          ${
            Number.isFinite(lo90) && Number.isFinite(hi90)
              ? `<div class="y10-range muted">近90日 ${lo90.toFixed(2)}–${hi90.toFixed(2)}%</div>`
              : ''
          }
        </div>
      </div>
      <div class="y10-nfa muted">#NFA · 数据源 FRED 日频</div>
    </div>
  `;
}
