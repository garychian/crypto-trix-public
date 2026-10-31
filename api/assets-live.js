/**
 * GET /api/assets-live
 *
 * Live overlays for the global assets page (stocks / REITs / crypto / gold·silver).
 * Free sources only — no API keys:
 *   - companiesmarketcap.com CSV  → USD market cap + price
 *   - Yahoo Finance v8 chart        → 24h / 1y % and spark (short UA; long UA → 429)
 *   - CoinGecko                     → crypto + RWA mcaps / changes + global total
 *
 * Frontend loads /data/assets.json as baseline, then merges this response by id.
 * If Yahoo rate-limits, CMC/CG still apply; missing ids stay on the static baseline
 * (client labels delayed + as_of). Never invents numbers.
 *
 * Cache: s-maxage=600, stale-while-revalidate=1800
 */
const UA_SHORT = 'Mozilla/5.0';
const UA_BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Match generate-assets.mjs: top N + always-include (REITs, CN namesakes, etc.). */
const ALWAYS = [
  'TCEHY',
  '600519.SS',
  '688825.SS',
  'SPCX',
  'WELL',
  'PLD',
  'EQIX',
  'SPG',
  'AMT',
  'DLR',
  'PSA',
  'O',
];
const TOP_N = 30;
/** Yahoo ticker when it differs from the CMC / assets id symbol. */
const YAHOO_SYM = { TCEHY: '0700.HK', GOOG: 'GOOG' };

const CRYPTO_IDS = [
  'bitcoin',
  'ethereum',
  'tether',
  'ripple',
  'binancecoin',
  'solana',
  'usd-coin',
  'dogecoin',
];
const RWA_IDS = [
  'tether-gold',
  'pax-gold',
  'kinesis-gold',
  'blackrock-usd-institutional-digital-liquidity-fund',
  'hashnote-usyc',
  'ondo-us-dollar-yield',
  'superstate-short-duration-us-government-securities-fund-ustb',
  'ousg',
  'janus-henderson-anemoy-treasury-fund',
  'spiko-amundi-overnight-swap-fund-eur',
  'eutbl',
  'janus-henderson-anemoy-aaa-clo-fund',
  'figure-heloc',
];

const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const todayCN = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const isoDate = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { headers = {}, retries = 2, timeoutMs = 12000 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 429) {
        last = new Error('429');
        await sleep(1500 * (i + 1));
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      last = e;
      await sleep(400 * (i + 1));
    }
  }
  throw last;
}

async function getText(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const r = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function parseCmcCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) =>
      (m[1] ?? m[2] ?? '').replace(/""/g, '"')
    );
    if (cells.length >= 5) {
      rows.push({
        rank: +cells[0],
        name: cells[1],
        symbol: cells[2],
        mcap: +cells[3],
        price: +cells[4],
      });
    }
  }
  return rows;
}

/** Yahoo v8 chart → price, chg24, chg1y, spark, date. Short UA required. */
async function yahooChart(symbol) {
  const j = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
    { headers: { 'User-Agent': UA_SHORT }, retries: 2, timeoutMs: 10000 }
  );
  const res = j.chart?.result?.[0];
  if (!res) throw new Error('no result');
  const closes = (res.indicators?.quote?.[0]?.close || []).filter((x) => x != null && Number.isFinite(x));
  if (closes.length < 2) throw new Error('too few closes');
  const price = res.meta?.regularMarketPrice ?? closes.at(-1);
  const prev = closes.at(-2);
  const first = closes[0];
  const metaChg = Number(res.meta?.regularMarketChangePercent);
  const step = Math.max(1, Math.floor(closes.length / 40));
  const spark = closes
    .filter((_, i) => i % step === 0 || i === closes.length - 1)
    .map((v) => +Number(v).toPrecision(5));
  return {
    price: round2(price),
    chg_24h: Number.isFinite(metaChg) ? round2(metaChg) : prev ? round2((price / prev - 1) * 100) : null,
    chg_1y: first ? round2((price / first - 1) * 100) : null,
    spark,
    data_date: res.meta?.regularMarketTime ? isoDate(res.meta.regularMarketTime) : todayCN(),
  };
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = { ok: true, value: await fn(items[idx], idx) };
        } catch (e) {
          out[idx] = { ok: false, error: e };
        }
      }
    })
  );
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache only successful responses at the CDN; errors are marked no-store below.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const asOf = todayCN();
  const updates = {};
  const warnings = [];
  let cmcHits = 0;
  let yahooHits = 0;
  let cgHits = 0;
  let cryptoTotal = null;

  // ── 1) companiesmarketcap CSV (stock / REIT USD mcaps) ───────────────────
  let cmcRows = null;
  try {
    const text = await getText('https://companiesmarketcap.com/?download=csv', {
      headers: { 'User-Agent': UA_BROWSER },
      timeoutMs: 25000,
    });
    cmcRows = parseCmcCsv(text);
  } catch (e) {
    warnings.push('companiesmarketcap: ' + (e && e.message));
  }

  const pick = [];
  if (cmcRows) {
    const seen = new Set();
    for (const r of cmcRows) {
      if (!r.symbol || !Number.isFinite(r.mcap) || r.mcap <= 0) continue;
      const want = r.rank <= TOP_N || ALWAYS.includes(r.symbol);
      if (!want || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      pick.push(r);
    }
    for (const r of pick) {
      const id = 'co-' + r.symbol.toLowerCase();
      // CMC mcap is USD; skip CMC price — Yahoo supplies local-currency last price
      updates[id] = {
        mcap_usd: Math.round(r.mcap),
        live: true,
        source: 'companiesmarketcap.com',
        data_date: asOf,
      };
      cmcHits++;
    }
  }

  // ── 2) Yahoo charts for chg / spark (and price fallback) ─────────────────
  const yahooTargets = [];
  if (pick.length) {
    for (const r of pick) {
      yahooTargets.push({
        id: 'co-' + r.symbol.toLowerCase(),
        yahoo: YAHOO_SYM[r.symbol] || r.symbol,
      });
    }
  } else {
    // CMC failed — still try Yahoo for a fixed always/top list so chg can refresh
    const fallback = [
      'NVDA',
      'AAPL',
      'GOOG',
      'MSFT',
      'AMZN',
      'TSM',
      'META',
      'AVGO',
      'TSLA',
      'BRK-B',
      'AMD',
      'LLY',
      'JPM',
      'WMT',
      'ORCL',
      'V',
      'XOM',
      'INTC',
      'JNJ',
      'MA',
      'COST',
      'PLTR',
      'MU',
      'ASML',
      'TCEHY',
      ...ALWAYS,
    ];
    const seen = new Set();
    for (const sym of fallback) {
      if (seen.has(sym)) continue;
      seen.add(sym);
      yahooTargets.push({ id: 'co-' + sym.toLowerCase(), yahoo: YAHOO_SYM[sym] || sym });
    }
  }

  // Metals for derived mcap scaling on the client
  yahooTargets.push({ id: 'gold', yahoo: 'GC=F' }, { id: 'silver', yahoo: 'SI=F' });

  const yResults = await mapPool(yahooTargets, 5, (t) => yahooChart(t.yahoo));
  yResults.forEach((r, i) => {
    const t = yahooTargets[i];
    if (!r.ok) {
      warnings.push('Yahoo ' + t.yahoo + ': ' + (r.error && r.error.message));
      return;
    }
    const y = r.value;
    const prev = updates[t.id] || {};
    updates[t.id] = {
      ...prev,
      // Prefer CMC mcap when present; Yahoo only fills price/chg/spark
      price: y.price ?? prev.price,
      chg_24h: y.chg_24h,
      chg_1y: y.chg_1y,
      spark: y.spark,
      data_date: y.data_date || prev.data_date || asOf,
      live: true,
      source: prev.source
        ? prev.source + ' · Yahoo Finance'
        : t.id === 'gold' || t.id === 'silver'
          ? 'Yahoo Finance ' + t.yahoo
          : 'Yahoo Finance',
    };
    yahooHits++;
  });

  // ── 3) CoinGecko crypto + RWA + global ───────────────────────────────────
  try {
    const ids = [...CRYPTO_IDS, ...RWA_IDS].join(',');
    const markets = await getJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h,1y`,
      { headers: { 'User-Agent': UA_BROWSER }, retries: 2, timeoutMs: 15000 }
    );
    if (Array.isArray(markets)) {
      for (const c of markets) {
        if (!c?.id || !c.market_cap) continue;
        updates[c.id] = {
          mcap_usd: Math.round(c.market_cap),
          price: c.current_price,
          chg_24h: round2(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h),
          chg_1y: round2(c.price_change_percentage_1y_in_currency),
          data_date: (c.last_updated || '').slice(0, 10) || asOf,
          live: true,
          source: 'CoinGecko /coins/markets',
        };
        cgHits++;
      }
    }
  } catch (e) {
    warnings.push('CoinGecko markets: ' + (e && e.message));
  }

  try {
    const glob = await getJson('https://api.coingecko.com/api/v3/global', {
      headers: { 'User-Agent': UA_BROWSER },
      retries: 2,
      timeoutMs: 12000,
    });
    if (glob?.data?.total_market_cap?.usd) {
      cryptoTotal = {
        mcap_usd: Math.round(glob.data.total_market_cap.usd),
        chg_24h: round2(glob.data.market_cap_change_percentage_24h_usd),
        btc_dominance: round2(glob.data.market_cap_percentage?.btc),
      };
    }
  } catch (e) {
    warnings.push('CoinGecko global: ' + (e && e.message));
  }

  const live = cmcHits > 0 || yahooHits > 0 || cgHits > 0;
  const degraded = !live || (cmcHits === 0 && yahooHits === 0);

  res.setHeader(
    'Cache-Control',
    degraded ? 'public, s-maxage=30, stale-while-revalidate=60' : 'public, s-maxage=600, stale-while-revalidate=1800'
  );

  res.status(200).json({
    as_of: asOf,
    generated_at: new Date().toISOString(),
    live,
    degraded,
    hits: { cmc: cmcHits, yahoo: yahooHits, coingecko: cgHits },
    crypto_total: cryptoTotal,
    updates,
    warnings: warnings.slice(0, 40),
    note: 'Merge over /data/assets.json by id. Stocks: CMC mcap + Yahoo chg. Crypto: CoinGecko. Gold/silver: Yahoo price (client scales derived mcap).',
  });
}
