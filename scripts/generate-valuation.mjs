/**
 * npm run valuation → public/data/valuation.json
 *
 * Per holding (public/data/holdings.json):
 *   eps_ttm  — GAAP diluted EPS, sum of last 4 fiscal quarters (SEC EDGAR companyfacts; Q4 = FY − Q1..Q3)
 *   rev_ttm  — revenue, same method (SEC)
 *   eps_ntm  — analyst consensus EPS for the next 4 unreported quarters (Nasdaq / Zacks, adjusted basis)
 *   mcap     — market cap snapshot (Nasdaq) + price at snapshot (price_ref)
 * The page multiplies by the live price: P/E = price/eps_ttm, 远期PE = price/eps_ntm,
 * 市值 = mcap × price/price_ref, P/S = 市值/rev_ttm. ETFs → all null. Missing → null (never guessed).
 *
 * Index-tracking ETFs (INDEX_ETFS: QQQ→Nasdaq-100, VOO→S&P 500) get the index's valuation instead:
 *   pe / fpe — WSJ Market Data "P/E & Yields" (Birinyi Associates; trailing = as-reported TTM,
 *              estimate = forward 12m operating), with the trade date
 *   ps       — multpl.com S&P 500 price/sales (S&P 500 only; no free NDX P/S → null)
 *   mcap     — sum of constituents' market caps (slickcharts; NDX fallback: Nasdaq nasdaq100 list,
 *              dual-class companies counted once)
 *   *_ref    — the ETF's close on each figure's date, so the page can scale by the ETF's live price.
 *
 * Needs a machine that reaches sec.gov + api.nasdaq.com (the box works). Re-run after earnings season.
 * Env: SEC_USER_AGENT or SEC_CONTACT_EMAIL (SEC requires a contact UA).
 */
import fs from 'node:fs/promises';

const SEC_UA =
  process.env.SEC_USER_AGENT || `CryptoTrix valuation ${process.env.SEC_CONTACT_EMAIL || 'contact@example.com'}`;
const WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// TTM facts older than this are ignored (e.g. BRK stopped tagging EPS in us-gaap after 2013)
const MAX_STALE_DAYS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, ua) {
  const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
const nq = (path) => getJSON('https://api.nasdaq.com/api/' + path, WEB_UA);
const nqSym = (s) => encodeURIComponent(s); // Nasdaq accepts BRK.B (a '/' would break the path)
const money = (v) => {
  const n = Number(String(v ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

/** Discrete fiscal quarters from 10-Q/10-K facts → TTM sum of the latest 4 consecutive quarters. */
function ttm(units) {
  if (!units) return null;
  const facts = new Map();
  for (const f of units) {
    if (!/^10-[QK]/.test(f.form || '') || !f.start || !f.end) continue;
    const k = f.start + '|' + f.end;
    const prev = facts.get(k);
    if (!prev || (f.filed || '') > (prev.filed || '')) facts.set(k, f);
  }
  const all = [...facts.values()];
  const q = new Map(); // end → {start,end,val}
  for (const f of all) {
    const d = days(f.start, f.end);
    if (d >= 80 && d <= 100) q.set(f.end, { start: f.start, end: f.end, val: f.val });
  }
  for (const a of all) {
    const d = days(a.start, a.end);
    if (d < 350 || d > 380 || q.has(a.end)) continue;
    const inside = [...q.values()].filter((x) => x.start >= a.start && x.end < a.end);
    if (inside.length === 3) {
      const last = inside.map((x) => x.end).sort().at(-1);
      q.set(a.end, { start: last, end: a.end, val: a.val - inside.reduce((s, x) => s + x.val, 0), derived: true });
    }
  }
  const qs = [...q.values()].sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 4);
  if (qs.length < 4) return null;
  for (let i = 0; i < 3; i++) {
    const gap = days(qs[i + 1].end, qs[i].end);
    if (gap < 80 || gap > 100) return null;
  }
  return { val: qs.reduce((s, x) => s + x.val, 0), end: qs[0].end };
}

function pickTTM(gaap, names, unit) {
  let best = null;
  for (const n of names) {
    const t = ttm(gaap[n] && gaap[n].units && gaap[n].units[unit]);
    if (t && (!best || t.end > best.end)) best = { ...t, concept: n };
  }
  return best;
}

async function secFundamentals(cik) {
  const j = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, SEC_UA);
  const g = (j.facts && j.facts['us-gaap']) || {};
  const eps = pickTTM(g, ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'], 'USD/shares');
  const rev = pickTTM(
    g,
    ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet'],
    'USD',
  );
  const ni = pickTTM(g, ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'], 'USD');
  const fresh = (x) => (x && days(x.end, new Date().toISOString().slice(0, 10)) <= MAX_STALE_DAYS ? x : null);
  return { eps: fresh(eps), rev: fresh(rev), ni: fresh(ni) };
}

async function nasdaqStuff(sym) {
  const s = nqSym(sym);
  const info = await nq(`quote/${s}/info?assetclass=stocks`).catch(() => null);
  let assetClass = info && info.data && info.data.assetClass;
  if (!assetClass) {
    const e = await nq(`quote/${s}/info?assetclass=etf`).catch(() => null);
    assetClass = e && e.data && e.data.assetClass;
  }
  if (assetClass === 'ETF') return { etf: true };
  const sum = await nq(`quote/${s}/summary?assetclass=stocks`);
  const mcap = money(sum.data && sum.data.summaryData && sum.data.summaryData.MarketCap && sum.data.summaryData.MarketCap.value);
  const price = money(info && info.data && info.data.primaryData && info.data.primaryData.lastSalePrice);
  let epsNtm = null;
  let ntmQuarters = null;
  try {
    const f = await nq(`analyst/${s}/earnings-forecast`);
    const rows = (f.data && f.data.quarterlyForecast && f.data.quarterlyForecast.rows) || [];
    const vals = rows.slice(0, 4).map((r) => Number(r.consensusEPSForecast));
    if (vals.length === 4 && vals.every(Number.isFinite)) {
      epsNtm = Math.round(vals.reduce((a, b) => a + b, 0) * 1000) / 1000;
      ntmQuarters = rows[0].fiscalEnd + '–' + rows[3].fiscalEnd;
    }
  } catch {
    /* no consensus */
  }
  return { etf: false, mcap, price, epsNtm, ntmQuarters };
}

const INDEX_ETFS = {
  QQQ: { index: 'NDX', name: '纳斯达克100', wsj: 'NASDAQ 100 Index', slick: 'nasdaq100', multplPS: null },
  VOO: { index: 'SPX', name: '标普500', wsj: 'S&P 500 Index', slick: 'sp500', multplPS: 's-p-500-price-to-sales' },
};

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': WEB_UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}
const mdyToISO = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(s || '');
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1]}-${m[2]}` : null;
};

let wsjHTML = null;
async function wsjPE(name) {
  wsjHTML ??= await getText('https://www.wsj.com/market-data/stocks/peyields');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"name":"${esc}","priceEarningsRatio":"([0-9.]+)","priceEarningsRatioEstimate":"([0-9.]+)"`);
  const m = re.exec(wsjHTML);
  if (!m) throw new Error('WSJ row not found: ' + name);
  const d = /"formattedTradeDate":"([0-9/]+)"/.exec(wsjHTML.slice(m.index));
  return { pe: Math.round(+m[1] * 100) / 100, fpe: Math.round(+m[2] * 100) / 100, date: mdyToISO(d && d[1]) };
}

async function multplPS(slug) {
  const h = await getText('https://www.multpl.com/' + slug);
  const m = /id="current"[\s\S]{0,400}?([0-9]+\.[0-9]+)[\s\S]{0,400}?(\d{1,2}:\d{2} [AP]M E[DS]T, \w{3} (\w{3}) (\d{1,2}))/.exec(h);
  if (!m) throw new Error('multpl parse');
  return { ps: +m[1], when: m[2] };
}

async function slickMcap(slug) {
  const h = await getText(`https://www.slickcharts.com/${slug}/marketcap`);
  const m = /\$([0-9.]+) trillion/.exec(h);
  if (!m) throw new Error('slickcharts parse');
  return +m[1] * 1e12;
}

async function nasdaq100Mcap() {
  const j = await nq('quote/list-type/nasdaq100');
  const root = (n) => String(n).replace(/\s+(Class [A-Z]\b.*|Common Stock.*|Capital Stock.*|Ordinary Shares.*|American Depositary.*)$/, '').trim();
  const by = new Map();
  for (const r of j.data.data.rows) {
    const v = money(r.marketCap);
    if (v) by.set(root(r.companyName), Math.max(by.get(root(r.companyName)) || 0, v));
  }
  return [...by.values()].reduce((a, b) => a + b, 0);
}

/** ETF closes by ISO date (Nasdaq historical). */
async function etfCloses(sym) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
  const j = await nq(`quote/${nqSym(sym)}/historical?assetclass=etf&fromdate=${from}&todate=${to}&limit=30`);
  const rows = (j.data && j.data.tradesTable && j.data.tradesTable.rows) || [];
  return rows.map((r) => ({ date: mdyToISO(r.date), close: money(r.close) })).filter((r) => r.date && r.close);
}

async function indexValuation(etf) {
  const cfg = INDEX_ETFS[etf];
  const idx = { index: cfg.index, name: cfg.name, pe: null, fpe: null, ps: null, mcap: null, sources: {} };
  const closes = await etfCloses(etf).catch(() => []);
  const closeOn = (iso) => (closes.find((c) => c.date <= iso) || {}).close ?? null;
  const latest = closes[0] || {};
  try {
    const w = await wsjPE(cfg.wsj);
    Object.assign(idx, { pe: w.pe, fpe: w.fpe, pe_date: w.date, pe_ref: closeOn(w.date) });
    idx.sources.pe = `WSJ P/E & Yields（Birinyi；TTM as-reported / 远期12个月 operating）${w.date}`;
  } catch (e) {
    console.warn(etf, 'wsj', e.message);
  }
  if (cfg.multplPS) {
    try {
      const m = await multplPS(cfg.multplPS);
      Object.assign(idx, { ps: m.ps, ps_date: latest.date, ps_ref: latest.close });
      idx.sources.ps = `multpl S&P 500 Price to Sales（${m.when}）`;
    } catch (e) {
      console.warn(etf, 'multpl', e.message);
    }
  }
  try {
    idx.mcap = await slickMcap(cfg.slick);
    idx.sources.mcap = `slickcharts 成分股总市值 ${latest.date || ''}`.trim();
  } catch (e) {
    if (cfg.index === 'NDX') {
      try {
        idx.mcap = await nasdaq100Mcap();
        idx.sources.mcap = `Nasdaq nasdaq100 成分股市值合计 ${latest.date || ''}`.trim();
      } catch (e2) {
        console.warn(etf, 'mcap', e2.message);
      }
    } else console.warn(etf, 'mcap', e.message);
  }
  if (idx.mcap) Object.assign(idx, { mcap_date: latest.date, mcap_ref: latest.close });
  return idx;
}

const holdings = JSON.parse(await fs.readFile('public/data/holdings.json', 'utf8')).holdings;
const tickers = [...new Set(holdings.map((h) => h.ticker))];
const ct = await getJSON('https://www.sec.gov/files/company_tickers.json', SEC_UA);
const cikOf = Object.fromEntries(Object.values(ct).map((v) => [v.ticker, v.cik_str]));

const out = {};
for (const t of tickers) {
  const row = { type: 'EQUITY', eps_ttm: null, eps_ttm_end: null, rev_ttm: null, eps_ntm: null, ntm: null, mcap: null, price_ref: null };
  try {
    const n = await nasdaqStuff(t);
    if (n.etf) {
      row.type = 'ETF';
      if (INDEX_ETFS[t]) row.index = await indexValuation(t);
      out[t] = row;
      console.log(t, 'ETF');
      continue;
    }
    Object.assign(row, { mcap: n.mcap, price_ref: n.price, eps_ntm: n.epsNtm, ntm: n.ntmQuarters });
  } catch (e) {
    console.warn(t, 'nasdaq', e.message);
  }
  const cik = cikOf[t.replace(/\./g, '-')];
  if (cik) {
    try {
      const { eps, rev, ni } = await secFundamentals(cik);
      if (eps) {
        row.eps_ttm = Math.round(eps.val * 1000) / 1000;
        row.eps_ttm_end = eps.end;
      } else if (ni && row.mcap && row.price_ref) {
        // no usable per-share tag (BRK): implied EPS so that price/EPS = market cap / TTM net income
        row.eps_ttm = Math.round(((ni.val * row.price_ref) / row.mcap) * 1000) / 1000;
        row.eps_ttm_end = ni.end;
        row.eps_basis = 'net_income/mcap';
      }
      if (rev) row.rev_ttm = rev.val;
    } catch (e) {
      console.warn(t, 'sec', e.message);
    }
    await sleep(250);
  }
  out[t] = row;
  console.log(t, JSON.stringify(row));
}

const asOf = new Date().toISOString().slice(0, 10);
await fs.writeFile(
  'public/data/valuation.json',
  JSON.stringify(
    {
      as_of: asOf,
      _source:
        'EPS/营收 TTM: SEC EDGAR（GAAP 摊薄）；远期 EPS: Nasdaq/Zacks 未来4季一致预期；市值: Nasdaq 快照 × 实时价/price_ref；' +
        'QQQ/VOO: 跟踪指数估值（PE/远期PE: WSJ·Birinyi；P/S: multpl 仅标普500；市值: slickcharts 成分股合计），*_ref = ETF 当日收盘，用于按 ETF 实时价缩放',
      data: out,
    },
    null,
    1,
  ) + '\n',
);
console.log('wrote public/data/valuation.json', asOf);
