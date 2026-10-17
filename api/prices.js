/**
 * Vercel serverless for GET /api/prices?symbols=TSLA,NVDA,BRK.B&hist=1
 *
 * Live quotes: Finnhub /quote when FINNHUB_TOKEN is set.
 * Period refs (weeklyRef / monthlyRef / yearlyRef) and hv30:
 *   when hist=1, computed from Yahoo daily closes (short UA).
 *   WTD = last close on or before previous Friday (calendar week start).
 *   MTD = last close of previous calendar month.
 *   YTD = last close of previous calendar year.
 * Fallback SNAPSHOT only when both live and hist fail.
 *
 * Never commit FINNHUB_TOKEN.
 */

const SNAPSHOT = {
  TSLA: { price: 370.59, changePct: 0, hv30: 60, weeklyRef: 370.59, monthlyRef: 354.81, yearlyRef: 449.72 },
  QQQ: { price: 749.58, changePct: 0, hv30: 18, weeklyRef: 749.58, monthlyRef: 720, yearlyRef: 520 },
  GOOGL: { price: 343.5, changePct: 0, hv30: 37, weeklyRef: 343.5, monthlyRef: 330, yearlyRef: 190 },
  VOO: { price: 707.54, changePct: 0, hv30: 11, weeklyRef: 707.54, monthlyRef: 690, yearlyRef: 540 },
  MSFT: { price: 517.53, changePct: 0, hv30: 25, weeklyRef: 517.53, monthlyRef: 500, yearlyRef: 420 },
  NVDA: { price: 233.95, changePct: 0, hv30: 44, weeklyRef: 233.95, monthlyRef: 220, yearlyRef: 140 },
  AMZN: { price: 251.52, changePct: 0, hv30: 35, weeklyRef: 251.52, monthlyRef: 240, yearlyRef: 220 },
  AMD: { price: 633.91, changePct: 0, hv30: 55, weeklyRef: 633.91, monthlyRef: 160, yearlyRef: 120 },
  META: { price: 728.08, changePct: 0, hv30: 35, weeklyRef: 728.08, monthlyRef: 570, yearlyRef: 585 },
  SPCX: { price: 158.96, changePct: 0, hv30: 80, weeklyRef: 158.96, monthlyRef: 140, yearlyRef: 90 },
  PLTR: { price: 188.75, changePct: 0, hv30: 70, weeklyRef: 188.75, monthlyRef: 160, yearlyRef: 75 },
  AAPL: { price: 333.69, changePct: 0, hv30: 25, weeklyRef: 333.69, monthlyRef: 255, yearlyRef: 250 },
  'BRK.B': { price: 502.65, changePct: 0, hv30: 18, weeklyRef: 502.65, monthlyRef: 505, yearlyRef: 450 },
  EUV: { price: 26.92, changePct: 0, hv30: 60, weeklyRef: 26.92, monthlyRef: 28, yearlyRef: 22 },
};

const round2 = (n) => Math.round(n * 100) / 100;

function yahooSymbol(sym) {
  return String(sym).replace(/\./g, '-');
}

function etDateISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Previous Friday relative to ET "today" (WTD anchor = last week close). */
function weekAnchorISO(todayISO) {
  const [y, m, d] = todayISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun … 5=Fri
  const back = dow === 0 ? 2 : dow === 6 ? 1 : dow + 2;
  return addDaysISO(todayISO, -back);
}

function monthAnchorISO(todayISO) {
  const [y, m] = todayISO.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1, 0));
  return last.toISOString().slice(0, 10);
}

function yearAnchorISO(todayISO) {
  const y = Number(todayISO.slice(0, 4));
  return `${y - 1}-12-31`;
}

function lastOnOrBefore(rows, iso) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].date <= iso) return rows[i];
  }
  return null;
}

function hv30FromCloses(closes) {
  const xs = closes.filter((n) => Number.isFinite(n) && n > 0);
  if (xs.length < 10) return null;
  const rets = [];
  for (let i = 1; i < xs.length; i++) rets.push(Math.log(xs[i] / xs[i - 1]));
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const var_ = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return round2(Math.sqrt(var_) * Math.sqrt(252) * 100);
}

async function finnhubCandle(sym, token) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 400 * 86400; // ~400 days
  const url =
    `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(sym)}` +
    `&resolution=D&from=${from}&to=${to}&token=${token}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('candle HTTP ' + r.status);
  const j = await r.json();
  if (j.s !== 'ok' || !j.c?.length || !j.t?.length) throw new Error('candle empty');
  const rows = [];
  for (let i = 0; i < j.t.length; i++) {
    const c = Number(j.c[i]);
    if (!Number.isFinite(c) || c <= 0) continue;
    rows.push({ date: new Date(j.t[i] * 1000).toISOString().slice(0, 10), close: c });
  }
  if (!rows.length) throw new Error('candle no closes');
  const today = etDateISO();
  const w = lastOnOrBefore(rows, weekAnchorISO(today));
  const m = lastOnOrBefore(rows, monthAnchorISO(today));
  const y = lastOnOrBefore(rows, yearAnchorISO(today));
  const last21 = rows.slice(-22).map((x) => x.close);
  return {
    weeklyRef: w ? round2(w.close) : null,
    monthlyRef: m ? round2(m.close) : null,
    yearlyRef: y ? round2(y.close) : null,
    hv30: hv30FromCloses(last21),
    lastClose: round2(rows[rows.length - 1].close),
  };
}

async function yahooHistory(sym) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(sym))}` +
    `?range=1y&interval=1d&includePrePost=false`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error('yahoo HTTP ' + r.status);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res?.timestamp?.length) throw new Error('yahoo empty');
  const closes = res.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const c = closes[i];
    if (!Number.isFinite(c) || c <= 0) continue;
    const iso = new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10);
    rows.push({ date: iso, close: c });
  }
  if (!rows.length) throw new Error('yahoo no closes');
  const today = etDateISO();
  const w = lastOnOrBefore(rows, weekAnchorISO(today));
  const m = lastOnOrBefore(rows, monthAnchorISO(today));
  const y = lastOnOrBefore(rows, yearAnchorISO(today));
  const last21 = rows.slice(-22).map((x) => x.close);
  return {
    weeklyRef: w ? round2(w.close) : null,
    monthlyRef: m ? round2(m.close) : null,
    yearlyRef: y ? round2(y.close) : null,
    hv30: hv30FromCloses(last21),
    lastClose: round2(rows[rows.length - 1].close),
  };
}

async function finnhubQuote(symbol, token) {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
    { headers: { accept: 'application/json' } }
  );
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const q = await r.json();
  const price = Number(q && q.c);
  if (!Number.isFinite(price) || price <= 0) throw new Error('no quote');
  const dp = Number(q && q.dp);
  return { price: round2(price), changePct: Number.isFinite(dp) ? round2(dp) : 0 };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const symbols = String((req.query && req.query.symbols) || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const keys = symbols.length ? symbols : Object.keys(SNAPSHOT);
  const wantHist =
    String((req.query && req.query.hist) || '') === '1' ||
    String((req.query && req.query.hist) || '').toLowerCase() === 'true';

  const token = process.env.FINNHUB_TOKEN;
  const out = {};

  for (const sym of keys) {
    out[sym] = SNAPSHOT[sym]
      ? Object.assign({}, SNAPSHOT[sym])
      : { price: null, changePct: null };
  }

  let liveHits = 0;
  if (token) {
    const results = await Promise.allSettled(keys.map((sym) => finnhubQuote(sym, token)));
    keys.forEach((sym, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        out[sym] = Object.assign({}, out[sym], r.value);
        liveHits++;
      }
    });
  }

  let histHits = 0;
  if (wantHist) {
    const results = await Promise.allSettled(
      keys.map(async (sym) => {
        if (token) {
          try { return await finnhubCandle(sym, token); } catch (_) { /* fall through */ }
        }
        return yahooHistory(sym);
      })
    );
    keys.forEach((sym, i) => {
      const r = results[i];
      if (r.status !== 'fulfilled') return;
      const h = r.value;
      out[sym] = Object.assign({}, out[sym], {
        weeklyRef: h.weeklyRef,
        monthlyRef: h.monthlyRef,
        yearlyRef: h.yearlyRef,
        hv30: h.hv30 != null ? h.hv30 : out[sym].hv30,
      });
      if (out[sym].price == null && h.lastClose != null) {
        out[sym].price = h.lastClose;
        out[sym].changePct = out[sym].changePct ?? 0;
      }
      histHits++;
    });
  }

  out.__source = liveHits > 0 ? 'live' : histHits > 0 ? 'live' : 'snapshot';
  out.__hist = histHits;
  res.status(200).json(out);
}
