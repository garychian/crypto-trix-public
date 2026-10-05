// 股息收入卡片 + 首页单行提示（数据：public/data/dividends.json，npm run dividends 生成）
const usd = (n, d = 0) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export async function loadDividends() {
  try {
    const r = await fetch('/data/dividends.json', { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function renderDividendCard(el) {
  if (!el) return;
  const d = await loadDividends();
  if (!d) { el.hidden = true; return; }
  const rows = [...d.stocks].sort((a, b) => b.annual - a.annual).map((s) => `
    <tr><td class="l">${s.ticker}</td><td>${s.shares}</td><td>${usd(s.ttm_per_share, 2)}</td><td>${s.yield_pct.toFixed(2)}%</td><td class="up">${usd(s.annual)}</td></tr>`).join('');
  const g = d.sgov;
  el.innerHTML = `
    <div class="panel-head"><h2>股息收入 Dividends</h2><span class="muted">截至 ${d.as_of}</span></div>
    <div class="div-hero">
      <div><div class="div-label">预计年股息</div><div class="div-big">${usd(d.total_annual)}</div></div>
      <div><div class="div-label">月均</div><div class="div-mid">${usd(d.monthly_avg)}</div></div>
      <div><div class="div-label">股票小计</div><div class="div-mid">${usd(d.stock_subtotal)}</div><div class="div-sub">股息率 ${d.stock_yield_pct.toFixed(2)}%</div></div>
    </div>
    <div class="div-sgov">
      <span class="div-sgov-name">${g.label}</span>
      <span class="div-sgov-val">${usd(g.annual)}/年 · ${g.yield_pct.toFixed(2)}%</span>
      <span class="div-sub">近月年化 ${usd(g.run_rate_annual)} · ${g.run_rate_yield_pct.toFixed(2)}%</span>
    </div>
    <div class="table-scroll">
      <table class="data div-table">
        <thead><tr><th class="l">标的</th><th>股数</th><th>年每股</th><th>股息率</th><th>年股息</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="vol-note">不派息：${d.non_payers.join('、')}<br>${d.note}。SGOV 计为现金，不在持仓内。</p>`;
}

export async function renderDividendHint(el) {
  if (!el) return;
  const d = await loadDividends();
  if (!d || !Number.isFinite(Number(d.total_annual))) {
    el.hidden = true;
    return;
  }
  const annual = usd(d.total_annual);
  const monthly = usd(d.monthly_avg);
  const asOf = d.as_of || '';
  el.hidden = false;
  el.innerHTML = `
    <div class="div-home-inner">
      <div class="div-home-head">
        <div>
          <div class="en">Dividends · Trailing 12M</div>
          <h2 class="div-home-title">股息收入</h2>
        </div>
        <a class="btn btn-ghost div-home-cta" href="/fund.html#dividend-card">明细 →</a>
      </div>
      <div class="div-home-nums">
        <div class="div-home-cell">
          <div class="div-label">预计年股息</div>
          <div class="div-big">${annual}</div>
        </div>
        <div class="div-home-cell">
          <div class="div-label">月均</div>
          <div class="div-mid">${monthly}</div>
        </div>
      </div>
      <p class="div-home-note muted">含股票 + SGOV · 截至 ${asOf} · 税前估算 · #NFA</p>
    </div>`;
}
