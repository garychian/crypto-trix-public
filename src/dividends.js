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
  if (!d) { el.hidden = true; return; }
  el.innerHTML = `<a href="/fund.html#dividend-card">预计年股息 <b>${usd(d.total_annual)}</b> · 月均 <b>${usd(d.monthly_avg)}</b></a>`;
  el.hidden = false;
}
