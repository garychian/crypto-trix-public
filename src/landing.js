import {
  DEMO_HOLDINGS,
  DEMO_CASH,
  DEMO_PRICES,
  FUND_CFG,
} from './data/demo.js';
import { usd } from './lib/format.js';

const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];

function msLabel(v) {
  return v >= 1e6 ? '$' + v / 1e6 + 'M' : '$' + v / 1e3 + 'K';
}

function computeAssets() {
  let holdingsMV = 0;
  for (const h of DEMO_HOLDINGS) {
    const q = DEMO_PRICES[h.ticker];
    const px = q?.price ?? h.price;
    const shares = h.mv != null && h.price != null ? h.mv / h.price : h.shares;
    holdingsMV += px * shares;
  }
  return holdingsMV + DEMO_CASH;
}

const total = computeAssets();
const progress = (total / FUND_CFG.goal) * 100;
const clamped = Math.min(100, progress);

document.getElementById('hero-pct').textContent = progress.toFixed(2) + '%';
document.getElementById('hero-assets').textContent = '总资产 ' + usd(total);
document.getElementById('hero-fill').style.width = clamped + '%';
document.getElementById('hero-knob').style.left = clamped + '%';

document.getElementById('hero-ms').innerHTML = MILESTONES.map((v) => {
  const hit = total >= v;
  return `<span class="${hit ? 'hit' : ''}">${hit ? '✓ ' : ''}${msLabel(v)}</span>`;
}).join('');
