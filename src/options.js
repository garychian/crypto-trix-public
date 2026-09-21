import './nav.js';
import { loadHoldingsData, holdingsSourceBadge } from './lib/holdings.js';
import { fetchPrices, priceSourceBadge, pricesFromHoldings } from './lib/prices.js';
import { marketStatus } from './lib/market.js';
import { fmtExpiry } from './lib/format.js';

let options = [];
let holdings = [];
let prices = {};
let holdingsMeta = null;
let handle = 'CRYPTOTRIX1';
let sub = 'US EQUITIES';

function typeZh(t) {
  return String(t || '')
    .replace('SELL PUT', '卖出看跌')
    .replace('BUY PUT', '买入看跌')
    .replace('SELL CALL', '卖出看涨')
    .replace('BUY CALL', '买入看涨')
    .replace('SELL ', '卖')
    .replace('BUY ', '买');
}

function dteOf(o) {
  return Math.ceil(
    (new Date(o.expiry + 'T23:59:59').getTime() - Date.now()) / 86400000
  );
}

function render() {
  document.getElementById('d-handle').textContent = handle;
  document.getElementById('d-sub').textContent = sub;

  const tb = document.getElementById('d-opt-rows');
  const sum = document.getElementById('opt-summary');

  if (!options.length) {
    document.getElementById('d-count').textContent = '0';
    document.getElementById('d-count-sub').textContent = '暂无合约';
    document.getElementById('d-prem').textContent = '—';
    document.getElementById('d-prem').className = 'value muted';
    document.getElementById('d-prem-sub').textContent = '';
    document.getElementById('d-nearest').textContent = '—';
    document.getElementById('d-nearest').className = 'value muted';
    document.getElementById('d-nearest-sub').textContent = '';
    document.getElementById('d-syms').textContent = '0';
    document.getElementById('d-syms-sub').textContent = '';
    tb.innerHTML =
      '<tr><td colspan="9" class="opt-empty">暂无期权合约 · options[] 为空</td></tr>';
    sum.textContent = '无合约';
    finishMeta();
    return;
  }

  const sorted = options.slice().sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    return dteOf(a) - dteOf(b);
  });

  const symbols = new Set(options.map((o) => o.symbol));
  const totalPrem = options.reduce((s, o) => s + (o.premium || 0), 0);
  let itm = 0;
  let nearest = null;

  tb.innerHTML = sorted
    .map((o) => {
      const dte = dteOf(o);
      const isPut = /PUT/.test(o.type);
      const p = prices[o.symbol];
      const spot = p && !p.error && p.price != null ? p.price : null;
      let cush = null;
      let stCls = 'st-flat';
      let stTxt = '—';

      if (spot != null) {
        cush = isPut
          ? ((spot - o.strike) / o.strike) * 100
          : ((o.strike - spot) / spot) * 100;
        if (dte <= 0) {
          stTxt = '已到期';
          stCls = 'st-flat';
        } else if (cush < 0) {
          stTxt = '🔴 价内';
          stCls = 'st-dn';
          itm++;
        } else if (cush < 8) {
          stTxt = '🟡 垫薄';
          stCls = 'st-warn';
        } else {
          stTxt = '🟢 安全';
          stCls = 'st-up';
        }
      } else {
        stTxt = '行情缺失';
      }

      if (dte > 0 && (!nearest || dte < nearest.dte)) {
        nearest = { sym: o.symbol, dte, expiry: o.expiry };
      }

      const cushCell =
        cush == null
          ? '<td class="muted">—</td>'
          : '<td class="' +
            (cush >= 0 ? 'up' : 'down') +
            '" style="font-weight:700">' +
            (cush >= 0 ? '+' : '') +
            cush.toFixed(1) +
            '% ' +
            (cush >= 0 ? 'OTM' : 'ITM') +
            '</td>';

      const dteCell =
        dte <= 0
          ? '<td class="muted">已到期' + -dte + '天</td>'
          : '<td class="' +
            (dte <= 14 ? 'down' : dte <= 45 ? 'muted' : 'up') +
            '" style="font-weight:700">' +
            dte +
            '天</td>';

      return (
        '<tr>' +
        '<td class="l"><span class="sym">' +
        o.symbol +
        '</span></td>' +
        '<td class="l"><span class="opt-type">' +
        typeZh(o.type) +
        '</span></td>' +
        '<td style="font-weight:700">$' +
        o.strike +
        '</td>' +
        '<td>' +
        fmtExpiry(o.expiry) +
        '</td>' +
        dteCell +
        '<td class="up" style="font-weight:700">+$' +
        (o.premium || 0).toLocaleString('en-US') +
        '</td>' +
        '<td>' +
        (spot != null ? '$' + Number(spot).toFixed(2) : '—') +
        '</td>' +
        cushCell +
        '<td><span class="st ' +
        stCls +
        '">' +
        stTxt +
        '</span></td>' +
        '</tr>'
      );
    })
    .join('');

  document.getElementById('d-count').textContent = String(options.length);
  document.getElementById('d-count-sub').textContent =
    itm > 0 ? itm + ' 笔价内' : '全部价外 🟢';

  const premEl = document.getElementById('d-prem');
  premEl.textContent = '+$' + totalPrem.toLocaleString('en-US');
  premEl.className = 'value up';
  document.getElementById('d-prem-sub').textContent = '已收权利金';

  const nearEl = document.getElementById('d-nearest');
  if (nearest) {
    nearEl.textContent = nearest.sym;
    nearEl.className = 'value flat';
    document.getElementById('d-nearest-sub').textContent =
      fmtExpiry(nearest.expiry) + ' · ' + nearest.dte + ' 天';
  } else {
    nearEl.textContent = '—';
    nearEl.className = 'value muted';
    document.getElementById('d-nearest-sub').textContent = '无未到期合约';
  }

  document.getElementById('d-syms').textContent = String(symbols.size);
  document.getElementById('d-syms-sub').textContent =
    [...symbols].sort().join(' · ');

  let html =
    '总权利金 <b>+$' +
    totalPrem.toLocaleString('en-US') +
    '</b> · ' +
    symbols.size +
    ' 标的 ' +
    options.length +
    ' 笔';
  html += itm > 0 ? ' · <span class="down">' + itm + ' 笔价内</span>' : ' · 全部价外 🟢';
  if (nearest) {
    html +=
      ' · 最近 ' +
      nearest.sym +
      ' ' +
      fmtExpiry(nearest.expiry) +
      '（' +
      nearest.dte +
      '天）';
  }
  sum.innerHTML = html;
  finishMeta();
}

function finishMeta() {
  const holdBadge = holdingsSourceBadge(holdingsMeta);
  const priceBadge = priceSourceBadge(prices);
  document.getElementById('data-badge').textContent =
    holdBadge + ' · ' + priceBadge;
  document.getElementById('lastupd').textContent =
    '更新于 ' +
    new Date().toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  const m = marketStatus();
  document.getElementById('mkt').innerHTML =
    '<span class="dot ' +
    (m.open ? 'dot-open' : 'dot-closed') +
    '"></span>' +
    m.shortZh;
}

async function boot() {
  const data = await loadHoldingsData();
  holdingsMeta = data;
  holdings = data.holdings || [];
  options = data.options || [];
  handle = data.handle || handle;
  sub = data.sub || sub;

  const syms = [...new Set(options.map((o) => o.symbol))];
  const snapshot = pricesFromHoldings(holdings, data.prices);
  prices = syms.length
    ? await fetchPrices(syms, { hist: false, snapshot })
    : { __source: 'snapshot' };
  render();
}

boot();
