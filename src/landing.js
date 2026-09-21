import './nav.js';
import { DEMO_PRICES } from './data/demo.js';
import { loadHoldingsData } from './lib/holdings.js';
import { usd } from './lib/format.js';

const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];

function msLabel(v) {
  return v >= 1e6 ? '$' + v / 1e6 + 'M' : '$' + v / 1e3 + 'K';
}

function computeAssets(holdings, cash, prices) {
  let holdingsMV = 0;
  for (const h of holdings) {
    const q = prices[h.ticker];
    const px = q?.price ?? h.price;
    if (px == null || !Number.isFinite(px)) continue;
    const shares = h.mv != null && h.price != null ? h.mv / h.price : h.shares;
    holdingsMV += px * shares;
  }
  return holdingsMV + (cash != null ? cash : 0);
}

async function boot() {
  const data = await loadHoldingsData();
  const total =
    data.total_assets_usd != null
      ? data.total_assets_usd
      : computeAssets(data.holdings, data.cash_usd, DEMO_PRICES);
  const goal = data.goal_usd || 2_000_000;
  const progress = (total / goal) * 100;
  const clamped = Math.min(100, progress);

  document.getElementById('hero-pct').textContent = progress.toFixed(2) + '%';
  document.getElementById('hero-assets').textContent = '总资产 ' + usd(total);
  document.getElementById('hero-fill').style.width = clamped + '%';
  document.getElementById('hero-knob').style.left = clamped + '%';

  document.getElementById('hero-ms').innerHTML = MILESTONES.map((v) => {
    const hit = total >= v;
    return `<span class="${hit ? 'hit' : ''}">${hit ? '✓ ' : ''}${msLabel(v)}</span>`;
  }).join('');
}

boot();
