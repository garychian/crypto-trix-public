#!/usr/bin/env node
/**
 * generate-assets.mjs — 全球资产排名数据（public/data/assets.json）
 *
 * Usage:  npm run assets
 *
 * 实时抓取（均为免 key 的公开接口，浏览器不直接调用，页面只读 assets.json）：
 *   - CoinGecko  /coins/markets   加密 Top、PAXG/XAUT/BUIDL/USDY 等代币化 RWA 的市值与涨跌
 *   - CoinGecko  /global          加密总市值
 *   - companiesmarketcap.com CSV  公司总市值（已折算美元）
 *   - Yahoo Finance v8 chart      黄金 GC=F、白银 SI=F、个股/加密 1 年走势与涨跌
 *   - US Treasury FiscalData      美国公共债务总额（每日）
 *   - FRED (St. Louis Fed)        美国 M2 货币供应（月度）
 * 静态参考（标「约」+来源+日期；需人工年度更新，见 STATIC 常量）：
 *   - 黄金地上存量 (WGC) / 白银地上存量 (Silver Institute) → 乘以实时金银价
 *   - 全球股市总市值、全球债券、全球房地产 (SIFMA / Savills)
 * 任一来源失败：沿用上一次 assets.json 里同 id 的条目并标 stale:true；
 * 条目过少（<25）则不覆盖文件。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/assets.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── 静态参考值：全部来自公开报告，必须带来源与日期；更新时只改这里 ──────────────
const STATIC = {
  goldTonnes: {
    value: 220700,
    source: 'World Gold Council · 地上黄金存量（2025 年末估计，2026-08 更新）× 实时金价',
    url: 'https://www.gold.org/goldhub/research/market-primer/gold-market-primer-market-size-and-structure',
    data_date: '2025-12-31',
  },
  silverBoz: {
    value: 19.3e9, // 盎司
    source: 'Silver Institute · 地上白银存量约 193 亿盎司（2023 年末，含饰品/工业品，大部分并不流通）× 实时银价',
    url: 'https://silverinstitute.org/wp-content/uploads/2025/02/Final_Price_Sensitivity_of_Above-Ground-Silver-Stocks.pdf',
    data_date: '2023-12-31',
  },
  globalEquity: {
    mcap: 157.8e12,
    source: 'SIFMA 2026 Capital Markets Fact Book · 全球股票总市值（WFE 口径为 $151.9T）',
    url: 'https://www.sifma.org/research/statistics/fact-book',
    data_date: '2025-12-31',
  },
  globalBonds: {
    mcap: 160.7e12,
    source: 'SIFMA 2026 Capital Markets Fact Book · 全球固定收益证券存量',
    url: 'https://www.sifma.org/research/statistics/fact-book',
    data_date: '2025-12-31',
  },
  globalRealEstate: {
    mcap: 393.3e12,
    source: 'Savills · 全球房地产总价值（住宅 $286.9T + 商业 $58.5T + 农地等）',
    url: 'https://www.savills.us/insight-and-opinion/savills-news/224715/savills--world-s-real-estate-worth-almost-$393.3-trillion--remains-the-world-s-largest-store-of-wealth--despite-drop-of-0.5--year-on-year',
    data_date: '2025-01-01',
  },
};
const OZ_PER_TONNE = 32150.7466;

const CN_NAMES = {
  NVDA: '英伟达', AAPL: '苹果', GOOG: '谷歌 Alphabet', GOOGL: '谷歌 Alphabet', MSFT: '微软', AMZN: '亚马逊', TSM: '台积电',
  SPCX: 'SpaceX', META: 'Meta', AVGO: '博通', '2222.SR': '沙特阿美', TSLA: '特斯拉', '005930.KS': '三星电子',
  MU: '美光科技', 'BRK-B': '伯克希尔', AMD: 'AMD', LLY: '礼来', '000660.KS': 'SK 海力士', JPM: '摩根大通',
  WMT: '沃尔玛', ASML: '阿斯麦', V: 'Visa', XOM: '埃克森美孚', INTC: '英特尔', JNJ: '强生', MA: '万事达',
  TCEHY: '腾讯', WELL: 'Welltower', PLD: 'Prologis 普洛斯', EQIX: 'Equinix', SPG: '西蒙地产', AMT: '美国铁塔', DLR: 'Digital Realty', PSA: 'Public Storage', O: 'Realty Income', '600519.SS': '贵州茅台', '688825.SS': 'CXMT', ABBV: '艾伯维', PLTR: 'Palantir', CSCO: '思科',
  ORCL: '甲骨文', COST: '开市客', '601939.SS': '建设银行', '1398.HK': '工商银行', '601288.SS': '农业银行',
};
const YAHOO_OVERRIDE = { TCEHY: '0700.HK', GOOG: 'GOOG' };
// 房地产类别的个体资产：全球市值最大的上市地产/REIT（来自同一 CSV）；总量类「全球房地产」只在「全部」里出现
const REITS = ['WELL', 'PLD', 'EQIX', 'SPG', 'AMT', 'DLR', 'PSA', 'O'];
const WANT_COMPANIES = { topN: 25, always: ['TCEHY', '600519.SS', ...REITS] };

const RWA = {
  'tether-gold': ['代币化黄金', 'Tether Gold'],
  'pax-gold': ['代币化黄金', 'PAX Gold'],
  'kinesis-gold': ['代币化黄金', 'Kinesis Gold'],
  'blackrock-usd-institutional-digital-liquidity-fund': ['代币化国债', 'BlackRock BUIDL'],
  'hashnote-usyc': ['代币化国债', 'Circle USYC'],
  'ondo-us-dollar-yield': ['代币化国债', 'Ondo USDY'],
  'superstate-short-duration-us-government-securities-fund-ustb': ['代币化国债', 'Superstate USTB'],
  ousg: ['代币化国债', 'Ondo OUSG'],
  'janus-henderson-anemoy-treasury-fund': ['代币化国债', 'Janus Anemoy JTRSY'],
  'spiko-amundi-overnight-swap-fund-eur': ['代币化货基', 'Spiko / Amundi EUR'],
  eutbl: ['代币化国债', 'Spiko EU T-Bills'],
  'janus-henderson-anemoy-aaa-clo-fund': ['代币化信贷', 'Janus Anemoy JAAA'],
  'figure-heloc': ['代币化房贷', 'Figure HELOC'],
};

const warnings = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayCN = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isoDate = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

async function getJson(url, { retries = 3, headers = {} } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { await sleep(6000 * (i + 1)); last = new Error('429'); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await sleep(1500); }
  }
  throw last;
}
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
const safe = async (label, fn) => {
  try { return await fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); console.warn('⚠', label, e.message); return null; }
};

// Yahoo v8 chart → { price, chg24, chg1y, spark, date }
async function yahoo(symbol) {
  await sleep(300);
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`, { retries: 3, headers: { 'User-Agent': 'Mozilla/5.0' } }); // Yahoo 429s long browser UAs
  const res = j.chart?.result?.[0];
  if (!res) throw new Error('no result ' + symbol);
  const closes = res.indicators.quote[0].close.filter((x) => x != null && Number.isFinite(x));
  if (closes.length < 5) throw new Error('too few closes ' + symbol);
  const price = res.meta.regularMarketPrice ?? closes.at(-1);
  const prev = closes.at(-2);
  const first = closes[0];
  const step = Math.max(1, Math.floor(closes.length / 40));
  const spark = closes.filter((_, i) => i % step === 0 || i === closes.length - 1).map((v) => +v.toPrecision(5));
  return {
    price,
    chg24: prev ? (price / prev - 1) * 100 : null,
    chg1y: first ? (price / first - 1) * 100 : null,
    spark,
    date: res.meta.regularMarketTime ? isoDate(res.meta.regularMarketTime) : todayCN(),
    currency: res.meta.currency,
  };
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/""/g, '"'));
    if (cells.length >= 6) rows.push({ rank: +cells[0], name: cells[1], symbol: cells[2], mcap: +cells[3], price: +cells[4], country: cells[5] });
  }
  return rows;
}

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

async function main() {
  const asOf = todayCN();
  let old = null;
  try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
  const items = [];

  // 1) 黄金 / 白银（Yahoo 期货价 × WGC / Silver Institute 存量）
  for (const [id, sym, name, nameEn, stock, kind] of [
    ['gold', 'GC=F', '黄金', 'Gold', STATIC.goldTonnes, 'gold'],
    ['silver', 'SI=F', '白银', 'Silver', STATIC.silverBoz, 'silver'],
  ]) {
    const y = await safe('Yahoo ' + sym, () => yahoo(sym));
    if (!y) continue;
    const oz = kind === 'gold' ? stock.value * OZ_PER_TONNE : stock.value;
    items.push({
      id, name, name_en: nameEn, symbol: sym.replace('=F', ''), category: '贵金属', type: 'asset',
      mcap_usd: Math.round(oz * y.price), price: r2(y.price), chg_24h: r2(y.chg24), chg_1y: r2(y.chg1y), spark: y.spark,
      kind: 'derived', approx: true,
      source: `价格：Yahoo Finance ${sym}（COMEX 期货≈现货）；存量：${stock.source}`,
      source_url: stock.url, data_date: y.date, stock_date: stock.data_date,
      note: kind === 'gold' ? '市值 ≈ 地上存量 × 金价' : '市值 ≈ 地上存量 × 银价；其中大部分为饰品/工业品，实际可交易量远小于此',
    });
  }

  // 2) 加密 Top + 全局
  const cg = 'https://api.coingecko.com/api/v3';
  const crypto = await safe('CoinGecko crypto', () =>
    getJson(`${cg}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h,1y`));
  let cryptoTotal = null;
  if (crypto) {
    for (const c of crypto.slice(0, 8)) {
      const sym = c.symbol.toUpperCase();
      const y = await safe('Yahoo ' + sym + '-USD', () => yahoo(sym + '-USD'));
      items.push({
        id: c.id, name: c.name, name_en: c.name, symbol: sym, category: '加密', type: 'asset',
        mcap_usd: Math.round(c.market_cap), price: c.current_price,
        chg_24h: r2(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h),
        chg_1y: r2(c.price_change_percentage_1y_in_currency), spark: y?.spark || null,
        kind: 'live', approx: false, source: 'CoinGecko /coins/markets' + (y ? ' · 走势 Yahoo Finance' : ''),
        source_url: 'https://www.coingecko.com/en/coins/' + c.id, data_date: (c.last_updated || '').slice(0, 10) || asOf,
      });
    }
  }
  await sleep(2500);
  const glob = await safe('CoinGecko global', () => getJson(`${cg}/global`));
  if (glob?.data) cryptoTotal = { mcap_usd: Math.round(glob.data.total_market_cap.usd), chg_24h: r2(glob.data.market_cap_change_percentage_24h_usd), btc_dominance: r2(glob.data.market_cap_percentage?.btc) };
  await sleep(2500);

  // 3) 代币化 RWA
  const rwa = await safe('CoinGecko RWA', () =>
    getJson(`${cg}/coins/markets?vs_currency=usd&ids=${Object.keys(RWA).join(',')}&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h,1y`));
  if (rwa) {
    for (const c of rwa) {
      const meta = RWA[c.id];
      if (!meta || !c.market_cap) continue;
      items.push({
        id: c.id, name: meta[1], name_en: c.name, symbol: c.symbol.toUpperCase(), category: '代币化RWA', rwa_type: meta[0], type: 'asset',
        mcap_usd: Math.round(c.market_cap), price: c.current_price,
        chg_24h: r2(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h),
        chg_1y: r2(c.price_change_percentage_1y_in_currency), spark: null,
        kind: 'live', approx: false, source: 'CoinGecko /coins/markets（real-world-assets 分类）',
        source_url: 'https://www.coingecko.com/en/coins/' + c.id, data_date: (c.last_updated || '').slice(0, 10) || asOf,
        note: '价格涨跌（净值型代币接近 0%）',
      });
    }
  }

  // 4) 公司市值
  const csvText = await safe('companiesmarketcap CSV', () => getText('https://companiesmarketcap.com/?download=csv'));
  if (csvText) {
    const rows = parseCsv(csvText);
    const pick = rows.filter((r) => r.rank <= WANT_COMPANIES.topN || WANT_COMPANIES.always.includes(r.symbol));
    const seen = new Set();
    let n = 0;
    const queue = pick.filter((r) => (seen.has(r.symbol) ? false : seen.add(r.symbol)));
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const r = queue.shift();
        const ys = YAHOO_OVERRIDE[r.symbol] || r.symbol;
        const y = await safe('Yahoo ' + ys, () => yahoo(ys));
        items.push({
          id: 'co-' + r.symbol.toLowerCase(), name: CN_NAMES[r.symbol] || r.name.replace(/&amp;/g, '&'), name_en: r.name, symbol: r.symbol === 'TCEHY' ? '0700.HK' : r.symbol,
          category: REITS.includes(r.symbol) ? '房地产' : '股票', ...(REITS.includes(r.symbol) ? { rwa_type: 'REIT' } : {}), type: 'asset', country: r.country,
          mcap_usd: Math.round(r.mcap), price: y ? r2(y.price) : null, chg_24h: y ? r2(y.chg24) : null, chg_1y: y ? r2(y.chg1y) : null, spark: y?.spark || null,
          kind: 'live', approx: false, source: 'companiesmarketcap.com（市值，已折美元）· 涨跌/走势 Yahoo Finance（最近交易日 / 近 1 年）',
          source_url: 'https://companiesmarketcap.com/', data_date: y?.date || asOf,
        });
        n++;
      }
    }));
  }

  // 5) 美国国债（FiscalData）+ M2（FRED）
  const debtNow = await safe('FiscalData debt', () =>
    getJson('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page%5Bsize%5D=1'));
  if (debtNow?.data?.[0]) {
    const d = debtNow.data[0];
    const cur = +d.tot_pub_debt_out_amt;
    const yAgo = new Date(d.record_date); yAgo.setUTCFullYear(yAgo.getUTCFullYear() - 1);
    const dPrev = await safe('FiscalData debt 1y', () =>
      getJson(`https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?filter=record_date:lte:${yAgo.toISOString().slice(0, 10)}&sort=-record_date&page%5Bsize%5D=1`));
    const prev = dPrev?.data?.[0] ? +dPrev.data[0].tot_pub_debt_out_amt : null;
    items.push({
      id: 'us-treasuries', name: '美国国债', name_en: 'US Treasuries (total public debt)', symbol: 'UST', category: '债券与现金类', type: 'asset',
      mcap_usd: Math.round(cur), chg_24h: null, chg_1y: prev ? r2((cur / prev - 1) * 100) : null, spark: null,
      kind: 'live', approx: false, source: 'U.S. Treasury FiscalData · Debt to the Penny（公共债务总额，含政府内部持有）',
      source_url: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/', data_date: d.record_date,
    });
  }
  const m2 = await safe('FRED M2', async () => {
    const t = await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL');
    const rows = t.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')).filter((r) => r[1] && r[1] !== '.');
    return rows;
  });
  if (m2?.length > 13) {
    const last = m2.at(-1), prev = m2.at(-13);
    items.push({
      id: 'us-m2', name: '美元 M2 货币供应', name_en: 'US M2 money stock', symbol: 'M2', category: '债券与现金类', type: 'asset',
      mcap_usd: Math.round(+last[1] * 1e9), chg_24h: null, chg_1y: r2((+last[1] / +prev[1] - 1) * 100), spark: null,
      kind: 'live', approx: false, source: 'Federal Reserve · FRED M2SL（季调，月度）',
      source_url: 'https://fred.stlouisfed.org/series/M2SL', data_date: last[0], note: '月度数据，日期为数据所属月份',
    });
  }

  // 6) 静态大类参考
  for (const [id, name, nameEn, sym, cat, s] of [
    ['global-equities', '全球股市总市值', 'Global equity market cap', 'EQ', '股票', STATIC.globalEquity],
    ['global-bonds', '全球债券市场', 'Global fixed income outstanding', 'BOND', '债券与现金类', STATIC.globalBonds],
    ['global-real-estate', '全球房地产', 'Global real estate value', 'RE', '房地产', STATIC.globalRealEstate],
  ]) {
    items.push({
      id, name, name_en: nameEn, symbol: sym, category: cat, type: 'class', mcap_usd: s.mcap, chg_24h: null, chg_1y: null, spark: null,
      kind: 'static', approx: true, source: s.source, source_url: s.url, data_date: s.data_date,
    });
  }

  // 失败来源：沿用旧值
  if (old?.items) {
    const have = new Set(items.map((i) => i.id));
    for (const o of old.items) {
      const wanted = !o.id.startsWith('co-') || WANT_COMPANIES.always.some((s) => o.id === 'co-' + s.toLowerCase()) || true;
      if (!have.has(o.id) && wanted && o.kind !== 'static' && !o.id.startsWith('co-')) { items.push({ ...o, stale: true }); warnings.push('stale: ' + o.id); }
    }
  }

  if (items.length < 25) {
    console.error(`✗ 只有 ${items.length} 条，疑似抓取失败，保留旧文件。`);
    process.exit(1);
  }
  items.sort((a, b) => b.mcap_usd - a.mcap_usd);

  const out = {
    as_of: asOf,
    generated_at: new Date().toISOString(),
    note: '实时项来自免 key 公开接口；静态项为公开报告的约数（标「约」）。股票/商品涨跌为最近一个交易日；仅供参考 · #NFA',
    crypto_total: cryptoTotal,
    sources: [
      { name: 'CoinGecko', url: 'https://www.coingecko.com/', kind: 'live', use: '加密与代币化 RWA 市值/涨跌' },
      { name: 'companiesmarketcap.com', url: 'https://companiesmarketcap.com/', kind: 'live', use: '公司总市值（美元）' },
      { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/', kind: 'live', use: '金银价格、个股涨跌与 1 年走势' },
      { name: 'U.S. Treasury FiscalData', url: 'https://fiscaldata.treasury.gov/', kind: 'live', use: '美国公共债务总额' },
      { name: 'FRED (Federal Reserve)', url: 'https://fred.stlouisfed.org/series/M2SL', kind: 'live', use: '美元 M2' },
      { name: 'World Gold Council', url: STATIC.goldTonnes.url, kind: 'static', use: '地上黄金存量 ≈ 22.07 万吨（2025 年末）' },
      { name: 'Silver Institute', url: STATIC.silverBoz.url, kind: 'static', use: '地上白银存量 ≈ 193 亿盎司（2023 年末）' },
      { name: 'SIFMA Fact Book 2026', url: STATIC.globalEquity.url, kind: 'static', use: '全球股市 / 债券总量（2025 年末）' },
      { name: 'Savills', url: STATIC.globalRealEstate.url, kind: 'static', use: '全球房地产总价值（2025 年初）' },
    ],
    warnings,
    items,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`✓ ${OUT}  ${items.length} items · as_of ${asOf}` + (warnings.length ? `  (${warnings.length} warnings)` : ''));
  for (const i of items) console.log(String(i.mcap_usd / 1e9 | 0).padStart(8), 'B', i.kind.padEnd(7), i.category, i.name, i.chg_24h, i.chg_1y);
}

main().catch((e) => { console.error(e); process.exit(1); });
