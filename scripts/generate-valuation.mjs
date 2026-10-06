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
      _source: 'EPS/营收 TTM: SEC EDGAR（GAAP 摊薄）；远期 EPS: Nasdaq/Zacks 未来4季一致预期；市值: Nasdaq 快照 × 实时价/price_ref',
      data: out,
    },
    null,
    1,
  ) + '\n',
);
console.log('wrote public/data/valuation.json', asOf);
