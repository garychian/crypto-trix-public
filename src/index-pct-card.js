/**
 * Index price-percentile card — S&P 500 + Nasdaq-100 vs window high/low.
 * Range chips: 近一年 / 今年 / 两年 / 三年.
 * Live first (/api/index-percentile → Yahoo), static /data/index-percentile.json fallback.
 *
 * Note: 近一年 (≈252 sessions) and 今年 (Jan 1 YTD) can show the same % when
 * both the window high and low fall inside the calendar year — not a shared
 * window-start bug. UI surfaces high/low dates + a coincidence hint.
 *
 * Also SPY / QQQ 本年最大回撤 (YTD max drawdown on daily closes).
 */

const MDD_ORDER = ['spy', 'qqq'];


const DEFAULT_WINDOWS = [
  { key: '1y', label: '近一年' },
  { key: 'ytd', label: '今年' },
  { key: '2y', label: '两年' },
  { key: '3y', label: '三年' },
];

const INDEX_ORDER = ['spx', 'ndx'];

async function loadIndexPct() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('/api/index-percentile', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const live = await res.json();
      if (live && live.indices && (live.indices.spx || live.indices.ndx)) return live;
    }
  } catch {
    /* fall through to snapshot */
  }
  const res = await fetch('/data/index-percentile.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtLevel(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(1) + '%';
}

/** MM-DD from YYYY-MM-DD (or full if malformed). */
function fmtMD(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[2]}-${m[3]}` : iso || '—';
}

/** Color band: low = green (near lows), mid = gold, high = red-ish caution. */
function pctTone(pct) {
  if (!Number.isFinite(pct)) return 'mid';
  if (pct < 33) return 'low';
  if (pct < 67) return 'mid';
  return 'high';
}

function barFill(pct) {
  const t = Math.min(100, Math.max(0, Number(pct) || 0));
  return t.toFixed(1);
}

/** Same hi/lo levels → percentile collapses across two different windows. */
function sameExtremes(a, b) {
  if (!a || !b) return false;
  return (
    Number(a.high) === Number(b.high) &&
    Number(a.low) === Number(b.low) &&
    a.from !== b.from
  );
}

function coincidenceNote(idx, rangeKey) {
  if (!idx?.ranges) return '';
  const cur = idx.ranges[rangeKey];
  if (!cur) return '';
  // When viewing 1y or ytd and they share extremes, explain why % matches.
  if (rangeKey === '1y' && sameExtremes(cur, idx.ranges.ytd)) {
    return `<div class="ipct-coinc muted">高低点均落在今年内 · 百分位与「今年」相同（窗口仍从 ${escapeHTML(cur.from)} 起，共 ${cur.n} 个交易日）</div>`;
  }
  if (rangeKey === 'ytd' && sameExtremes(cur, idx.ranges['1y'])) {
    const y1 = idx.ranges['1y'];
    return `<div class="ipct-coinc muted">与「近一年」高低点相同 · 近一年多出的 ${y1.n - cur.n} 个交易日未改区间极值</div>`;
  }
  return '';
}

function indexRowHTML(idx, rangeKey) {
  if (!idx) return '';
  const r = (idx.ranges && idx.ranges[rangeKey]) || null;
  const pct = r ? Number(r.pct) : NaN;
  const tone = pctTone(pct);
  const proxyNote = idx.proxy
    ? `<span class="ipct-proxy" title="指数不可用，使用 ETF 代理">代理 ${escapeHTML(idx.proxy)}</span>`
    : '';
  const loDate = r?.low_date ? ` · ${fmtMD(r.low_date)}` : '';
  const hiDate = r?.high_date ? ` · ${fmtMD(r.high_date)}` : '';
  return `
    <article class="ipct-idx" data-key="${escapeHTML(idx.key || '')}">
      <div class="ipct-idx-head">
        <div class="ipct-idx-names">
          <span class="ipct-idx-name">${escapeHTML(idx.name || '')}</span>
          <span class="ipct-idx-en muted">${escapeHTML(idx.name_en || idx.symbol || '')}</span>
          ${proxyNote}
        </div>
        <div class="ipct-idx-price">
          <span class="ipct-price-val">${fmtLevel(idx.price)}</span>
          <span class="ipct-price-lbl muted">现价</span>
        </div>
      </div>
      <div class="ipct-pct-row">
        <div class="ipct-pct ${tone}" data-pct="${Number.isFinite(pct) ? pct : ''}">
          <span class="ipct-pct-num">${fmtPct(pct)}</span>
          <span class="ipct-pct-lbl">区间百分位</span>
        </div>
        <div class="ipct-bar-wrap" aria-hidden="true">
          <div class="ipct-bar-track">
            <div class="ipct-bar-fill ${tone}" style="width:${barFill(pct)}%"></div>
            <div class="ipct-bar-thumb ${tone}" style="left:${barFill(pct)}%"></div>
          </div>
          <div class="ipct-bar-ends muted">
            <span>低 ${r ? fmtLevel(r.low) : '—'}${loDate}</span>
            <span>高 ${r ? fmtLevel(r.high) : '—'}${hiDate}</span>
          </div>
        </div>
      </div>
      <div class="ipct-range-meta muted">
        ${
          r
            ? `窗口 ${escapeHTML(r.from)} → ${escapeHTML(r.to)} · ${r.n || '—'} 个交易日`
            : '暂无该窗口数据'
        }
      </div>
      ${coincidenceNote(idx, rangeKey)}
    </article>`;
}


function fmtMdd(n) {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  // Always show sign for drawdowns (0 → 0.00%)
  if (v === 0) return '0.00%';
  const sign = v > 0 ? '+' : '−';
  return sign + Math.abs(v).toFixed(2) + '%';
}

function mddCardHTML(row) {
  if (!row) return '';
  const mdd = Number(row.mdd_pct);
  return `
    <article class="ipct-mdd-item" data-key="${escapeHTML(row.key || '')}">
      <div class="ipct-mdd-top">
        <div class="ipct-mdd-names">
          <span class="ipct-mdd-sym">${escapeHTML(row.symbol || row.name || '')}</span>
          <span class="ipct-mdd-zh muted">${escapeHTML(row.name_zh || '')}</span>
        </div>
        <div class="ipct-mdd-val" title="本年最大回撤 = min(收盘/滚动最高 − 1)">
          <span class="ipct-mdd-num">${fmtMdd(mdd)}</span>
          <span class="ipct-mdd-lbl">本年最大回撤</span>
        </div>
      </div>
      <div class="ipct-mdd-meta muted">
        峰值 ${fmtLevel(row.peak)} · ${fmtMD(row.peak_date)}
        → 谷底 ${fmtLevel(row.trough)} · ${fmtMD(row.trough_date)}
        · ${row.n || '—'} 个交易日
      </div>
    </article>`;
}

function mddStripHTML(mddYtd) {
  if (!mddYtd || typeof mddYtd !== 'object') return '';
  const cards = MDD_ORDER.map((k) => mddCardHTML(mddYtd[k])).filter(Boolean);
  if (!cards.length) return '';
  return `
    <div class="ipct-mdd" aria-label="SPY QQQ 本年最大回撤">
      <div class="ipct-mdd-head">
        <span class="ipct-mdd-title">ETF · 本年最大回撤</span>
        <span class="ipct-mdd-sub muted">年初至今 · 日线收盘 · min(收盘/滚动最高−1)</span>
      </div>
      <div class="ipct-mdd-grid">${cards.join('')}</div>
    </div>`;
}

function renderBody(root, data, rangeKey) {
  const windows = Array.isArray(data.windows) && data.windows.length ? data.windows : DEFAULT_WINDOWS;
  const indices = data.indices || {};
  const asOf = data.as_of || '—';
  const isLive = Boolean(data.live);
  const source = data.source || 'Yahoo Finance';

  const chips = windows
    .map((w) => {
      const on = w.key === rangeKey;
      return `<button type="button" class="ipct-pill${on ? ' active' : ''}" role="tab" data-range="${escapeHTML(w.key)}" aria-selected="${on ? 'true' : 'false'}">${escapeHTML(w.label)}</button>`;
    })
    .join('');

  const rows = INDEX_ORDER.map((k) => indexRowHTML(indices[k], rangeKey))
    .filter(Boolean)
    .join('');

  const asOfLine = isLive
    ? `as of ${escapeHTML(asOf)} · 实时接口`
    : `as of ${escapeHTML(asOf)} · 静态快照（可刷新）`;

  // Chip hint under subtitle when 1y≈ytd across both indices
  const bothCoincide =
    INDEX_ORDER.every((k) => {
      const idx = indices[k];
      return idx && sameExtremes(idx.ranges?.['1y'], idx.ranges?.ytd);
    }) && (rangeKey === '1y' || rangeKey === 'ytd');

  const headHint = bothCoincide
    ? `<p class="ipct-hint muted">近一年与今年窗口不同，但高低点都在今年内，故百分位相同。</p>`
    : '';

  root.innerHTML = `
    <div class="ipct-card-inner">
      <div class="ipct-head">
        <div class="ipct-head-text">
          <div class="en">Index · Price Percentile</div>
          <h2 id="ipct-title">美股指数 · 历史价格百分位</h2>
          <p class="ipct-sub muted">现价在所选窗口高低区间中的位置 · (现价−低)/(高−低) · 近一年≈252交易日 · 今年=年初至今</p>
          ${headHint}
        </div>
        <div class="ipct-range" role="tablist" aria-label="时间窗口">${chips}</div>
      </div>
      <div class="ipct-body">${rows || '<p class="muted">暂无指数数据</p>'}</div>
      ${mddStripHTML(data.mdd_ytd)}
      <div class="ipct-foot">
        <span class="ipct-asof muted">${asOfLine}</span>
        <span class="ipct-nfa muted">#NFA · ${escapeHTML(source)}</span>
      </div>
    </div>
  `;
}

export async function renderIndexPctCard() {
  const root = document.getElementById('index-pct');
  if (!root) return;

  let data;
  try {
    data = await loadIndexPct();
  } catch {
    root.innerHTML = `<div class="ipct-card-inner"><div class="ipct-error muted">指数百分位数据加载失败</div></div>`;
    return;
  }

  let rangeKey = '1y';
  const windows = Array.isArray(data.windows) && data.windows.length ? data.windows : DEFAULT_WINDOWS;
  if (!windows.some((w) => w.key === rangeKey)) rangeKey = windows[0].key;

  function paint() {
    renderBody(root, data, rangeKey);
    root.querySelectorAll('.ipct-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.range;
        if (!next || next === rangeKey) return;
        rangeKey = next;
        paint();
      });
    });
  }

  paint();
}
