/**
 * Index price-percentile card — S&P 500 + Nasdaq-100 vs window high/low.
 * Range chips: 近一年 / 今年 / 两年 / 三年.
 * Live first (/api/index-percentile → Yahoo), static /data/index-percentile.json fallback.
 */

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

function indexRowHTML(idx, rangeKey) {
  if (!idx) return '';
  const r = (idx.ranges && idx.ranges[rangeKey]) || null;
  const pct = r ? Number(r.pct) : NaN;
  const tone = pctTone(pct);
  const proxyNote = idx.proxy
    ? `<span class="ipct-proxy" title="指数不可用，使用 ETF 代理">代理 ${escapeHTML(idx.proxy)}</span>`
    : '';
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
            <span>低 ${r ? fmtLevel(r.low) : '—'}</span>
            <span>高 ${r ? fmtLevel(r.high) : '—'}</span>
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
    </article>`;
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

  root.innerHTML = `
    <div class="ipct-card-inner">
      <div class="ipct-head">
        <div class="ipct-head-text">
          <div class="en">Index · Price Percentile</div>
          <h2 id="ipct-title">美股指数 · 历史价格百分位</h2>
          <p class="ipct-sub muted">现价在所选窗口高低区间中的位置 · (现价−低)/(高−低)</p>
        </div>
        <div class="ipct-range" role="tablist" aria-label="时间窗口">${chips}</div>
      </div>
      <div class="ipct-body">${rows || '<p class="muted">暂无指数数据</p>'}</div>
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
