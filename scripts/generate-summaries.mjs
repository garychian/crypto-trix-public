#!/usr/bin/env node
/**
 * generate-summaries.mjs — builds public/data/summaries.json (周总结 / 月总结), data only.
 * No network. Idempotent. Run after every holdings.json / cn-fund.json / fund-checkins.json update:
 *
 *   npm run summaries            (or: node scripts/generate-summaries.mjs [--dry-run])
 *
 * Inputs : public/data/{holdings,cn-fund,capital,fund-checkins}.json, public/data/snapshots/*.json
 * Outputs: public/data/snapshots/<close-date>-us.json / -cn.json  (today's snapshots, overwritten per date)
 *          public/data/summaries.json                              (newest first)
 * Prints : SUMMARIES_CHANGED or SUMMARIES_UP_TO_DATE (sync-site.sh greps for "CHANGED").
 *
 * Rules
 *  - holdings.json `as_of` MUST be the US market-close date the numbers represent.
 *  - Week = Mon–Fri closes, ISO week id (2026-W40). The week of the latest snapshot is (re)generated every run;
 *    older weeks are generated once (when a start+end snapshot exist) and then frozen.
 *  - Month entry: generated/overwritten when the latest snapshot IS the month's last US trading day;
 *    otherwise created once for any finished month that has no entry yet (needs a snapshot on its last trading day).
 *  - US P&L = Σ daily `pnl` of fund-checkins.json rows whose market-close date (row date − previous weekday,
 *    or `close_date`) falls in the period. Start value = previous-close snapshot total; if no such snapshot,
 *    end total − pnl − dated deposits (flagged start_derived). Fields that can't be computed are omitted.
 *  - Contributions are PRICE effects on the opening holdings (shares_start × Δprice); they ignore trades and cash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(root, 'public/data');
const SNAP = path.join(DATA, 'snapshots');
const DRY = process.argv.includes('--dry-run');

const readJSON = (f, d = null) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return d;
  }
};
const r2 = (n) => Math.round(n * 100) / 100;
const r0 = (n) => Math.round(n);

/* ── dates (all UTC, ISO strings) ── */
const D = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(D(s).getTime() + n * 86400000));
const dow = (s) => D(s).getUTCDay(); // 0 Sun
const isWeekday = (s) => dow(s) >= 1 && dow(s) <= 5;
const prevWeekday = (s) => {
  let x = addDays(s, -1);
  while (!isWeekday(x)) x = addDays(x, -1);
  return x;
};
const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7));
function isoWeekId(s) {
  const dt = D(s);
  const thu = new Date(dt.getTime() + (3 - ((dt.getUTCDay() + 6) % 7)) * 86400000);
  const y = thu.getUTCFullYear();
  const jan1 = Date.UTC(y, 0, 1);
  const wk = Math.floor((thu.getTime() - jan1) / 86400000 / 7) + 1;
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

/* ── US market holidays (basic NYSE list) ── */
function nthWeekday(y, m, wd, n) {
  let d = new Date(Date.UTC(y, m, 1));
  let c = 0;
  while (true) {
    if (d.getUTCDay() === wd && ++c === n) return iso(d);
    d = new Date(d.getTime() + 86400000);
  }
}
function lastWeekday(y, m, wd) {
  let d = new Date(Date.UTC(y, m + 1, 0));
  while (d.getUTCDay() !== wd) d = new Date(d.getTime() - 86400000);
  return iso(d);
}
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(Date.UTC(y, mo - 1, da)));
}
const holidayCache = {};
function holidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const obs = (s, newYear) => {
    const w = dow(s);
    if (w === 6) return newYear ? null : addDays(s, -1);
    if (w === 0) return addDays(s, 1);
    return s;
  };
  const set = new Set(
    [
      obs(`${y}-01-01`, true),
      nthWeekday(y, 0, 1, 3), // MLK
      nthWeekday(y, 1, 1, 3), // Presidents
      addDays(easter(y), -2), // Good Friday
      lastWeekday(y, 4, 1), // Memorial
      obs(`${y}-06-19`),
      obs(`${y}-07-04`),
      nthWeekday(y, 8, 1, 1), // Labor
      nthWeekday(y, 10, 4, 4), // Thanksgiving
      obs(`${y}-12-25`),
    ].filter(Boolean)
  );
  return (holidayCache[y] = set);
}
const isTradingDay = (s) => isWeekday(s) && !holidays(Number(s.slice(0, 4))).has(s);
function lastTradingDay(y, m /* 1-12 */) {
  let s = iso(new Date(Date.UTC(y, m, 0)));
  while (!isTradingDay(s)) s = addDays(s, -1);
  return s;
}

/* ── load inputs ── */
const holdingsJ = readJSON(path.join(DATA, 'holdings.json'));
const cnJ = readJSON(path.join(DATA, 'cn-fund.json'));
const capital = readJSON(path.join(DATA, 'capital.json'), {});
const checkins = readJSON(path.join(DATA, 'fund-checkins.json'), { series: [] });
const prevSummaries = readJSON(path.join(DATA, 'summaries.json'), []);
let changed = false;

const writeIfChanged = (file, obj) => {
  const text = JSON.stringify(obj, null, 2) + '\n';
  let old = null;
  try {
    old = fs.readFileSync(file, 'utf8');
  } catch {}
  if (old === text) return false;
  if (!DRY) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return true;
};

/* ── today's snapshots (file name = market-close date) ── */
if (holdingsJ && holdingsJ.as_of && isWeekday(holdingsJ.as_of) && Array.isArray(holdingsJ.holdings)) {
  const snap = {
    date: holdingsJ.as_of,
    source: 'public/data/holdings.json',
    total_usd: Number(holdingsJ.total_assets_usd),
    cash_usd: Number(holdingsJ.cash_usd),
    holdings: holdingsJ.holdings.map((h) => ({
      ticker: h.ticker,
      shares: Number(h.shares),
      price: h.price != null ? Number(h.price) : null,
      mv: h.mv != null ? Number(h.mv) : h.price != null ? r2(Number(h.price) * Number(h.shares)) : null,
      cost_total: h.costTotal != null ? Number(h.costTotal) : null,
    })),
  };
  if (Number.isFinite(snap.total_usd) && writeIfChanged(path.join(SNAP, `${snap.date}-us.json`), snap)) changed = true;
} else {
  console.error('WARN: holdings.json as_of missing or not a weekday; US snapshot not written');
}
if (cnJ && cnJ.as_of && Number(cnJ.total_wan) > 0) {
  const snap = {
    date: cnJ.as_of,
    source: 'public/data/cn-fund.json',
    total_wan: Number(cnJ.total_wan),
    categories: (cnJ.categories || []).map((c) => ({ name: c.name, amount_wan: Number(c.amount_wan) })),
    funds: (cnJ.holdings || []).map((h) => ({ name: h.name, amount_wan: Number(h.amount_wan), category: h.category })),
  };
  if (writeIfChanged(path.join(SNAP, `${snap.date}-cn.json`), snap)) changed = true;
}

const loadSnaps = (suffix) => {
  let files = [];
  try {
    files = fs.readdirSync(SNAP).filter((f) => f.endsWith(`-${suffix}.json`));
  } catch {}
  return files
    .map((f) => readJSON(path.join(SNAP, f)))
    .filter((s) => s && s.date)
    .sort((a, b) => a.date.localeCompare(b.date));
};
const usSnaps = loadSnaps('us');
const cnSnaps = loadSnaps('cn');
const latestDate = usSnaps.length ? usSnaps[usSnaps.length - 1].date : null;
const lastOnOrBefore = (arr, d) => [...arr].reverse().find((s) => s.date <= d) || null;
const lastBefore = (arr, d) => [...arr].reverse().find((s) => s.date < d) || null;

/* ── check-in rows by market-close date ── */
const rows = (checkins.series || [])
  .filter((r) => r && r.date && Number.isFinite(Number(r.pnl)))
  .map((r) => ({ close: r.close_date || prevWeekday(r.date), pnl: Number(r.pnl) }))
  .sort((a, b) => a.close.localeCompare(b.close));

const fx = Number(capital.fx_usdcny) > 0 ? Number(capital.fx_usdcny) : null;
const deposits = Array.isArray(capital.deposits) ? capital.deposits : [];

/* ── period builder ── */
function build(type, id, start, end) {
  const inP = rows.filter((r) => r.close >= start && r.close <= end);
  const endSnap = lastOnOrBefore(usSnaps, end);
  if (!inP.length || !endSnap || endSnap.date < start) return null;
  const baseSnap = lastBefore(usSnaps, start);
  const baseOk = baseSnap && (D(start) - D(baseSnap.date)) / 86400000 <= 4;
  const pnl = inP.reduce((s, r) => s + r.pnl, 0);
  const dep = deposits.filter((x) => x.date >= start && x.date <= end).reduce((s, x) => s + Number(x.amount_usd || 0), 0);
  const totalEnd = endSnap.total_usd;
  const totalStart = baseOk ? baseSnap.total_usd : totalEnd - pnl - dep;
  if (type === 'week' && !baseOk) return null; // weeks need a real opening snapshot
  const us = {
    pnl_usd: r0(pnl),
    pct: totalStart > 0 ? r2((pnl / totalStart) * 100) : undefined,
    total_start: r2(totalStart),
    total_end: r2(totalEnd),
    ...(baseOk ? {} : { start_derived: true }),
    closes: inP.length,
    daily: inP.map((r) => ({ date: r.close, pnl_usd: r0(r.pnl) })),
    cash_pct_end: totalEnd > 0 ? r2((endSnap.cash_usd / totalEnd) * 100) : undefined,
  };
  if (baseOk) {
    // account value moved by more than the check-in pnl explains (broker re-anchor, unrecorded flows)
    const gap = r0(totalEnd - totalStart - pnl - dep);
    if (Math.abs(gap) >= 50) us.unreconciled_usd = gap;
  }
  if (baseOk && baseSnap.total_usd > 0) us.cash_pct_start = r2((baseSnap.cash_usd / baseSnap.total_usd) * 100);
  if (baseOk) {
    const b = new Map(baseSnap.holdings.map((h) => [h.ticker, h]));
    const e = new Map(endSnap.holdings.map((h) => [h.ticker, h]));
    const contrib = [];
    for (const [t, bh] of b) {
      const eh = e.get(t);
      if (!eh || bh.price == null || eh.price == null || !(bh.price > 0)) continue;
      contrib.push({
        ticker: t,
        contribution_usd: r0(bh.shares * (eh.price - bh.price)),
        price_pct: r2((eh.price / bh.price - 1) * 100),
      });
    }
    us.top_gainers = contrib.filter((c) => c.contribution_usd > 0).sort((a, c) => c.contribution_usd - a.contribution_usd).slice(0, 3);
    us.top_losers = contrib.filter((c) => c.contribution_usd < 0).sort((a, c) => a.contribution_usd - c.contribution_usd).slice(0, 3);
    const changes = [];
    for (const t of new Set([...b.keys(), ...e.keys()])) {
      const s0 = b.get(t)?.shares ?? 0;
      const s1 = e.get(t)?.shares ?? 0;
      const delta = r2(s1 - s0);
      if (Math.abs(delta) < 0.1) continue; // ignore fractional-share noise (DRIP, rounding)
      changes.push({
        ticker: t,
        kind: s0 === 0 ? 'new' : s1 === 0 ? 'closed' : delta > 0 ? 'added' : 'trimmed',
        shares_delta: delta,
        shares_start: s0,
        shares_end: s1,
      });
    }
    us.position_changes = changes.sort((a, c) => a.ticker.localeCompare(c.ticker));
  }

  const entry = { type, id, period_start: start, period_end: end, us };

  // A股: current allocation + change vs the previous snapshot (only if two distinct snapshots exist)
  const cnEnd = lastOnOrBefore(cnSnaps, end);
  if (cnEnd) {
    const cn = { as_of: cnEnd.date, total_wan_end: cnEnd.total_wan };
    const cnBase = lastBefore(cnSnaps, start);
    if (cnBase && cnBase.date !== cnEnd.date) {
      cn.total_wan_start = cnBase.total_wan;
      cn.change_wan = r2(cnEnd.total_wan - cnBase.total_wan);
      const diff = (a, b) => {
        const bm = new Map(b.map((x) => [x.name, x.amount_wan]));
        const out = [];
        for (const x of a) {
          const d = r2(x.amount_wan - (bm.get(x.name) ?? 0));
          if (Math.abs(d) >= 0.005) out.push({ name: x.name, change_wan: d });
        }
        return out;
      };
      cn.category_changes = diff(cnEnd.categories, cnBase.categories);
      cn.fund_changes = diff(cnEnd.funds, cnBase.funds);
    }
    entry.cn = cn;
    if (fx) {
      entry.combined = { fx_usdcny: fx, total_usd_end: r0(totalEnd + (cnEnd.total_wan * 10000) / fx) };
    }
  }
  // YTD only for the entry that ends at the latest data (deposits total is "as of now")
  if (endSnap.date === latestDate && Number.isFinite(Number(capital.start_of_year_usd)) && Number.isFinite(Number(capital.deposits_total_usd))) {
    const base = Number(capital.start_of_year_usd) + Number(capital.deposits_total_usd);
    const ytdUsd = totalEnd - base;
    entry.combined = { ...(entry.combined || {}), ytd_usd: r0(ytdUsd), ytd_pct: r2((ytdUsd / base) * 100) };
  }
  return entry;
}

/* ── which periods ── */
const prevByKey = new Map(prevSummaries.map((e) => [`${e.type}:${e.id}`, e]));
const out = new Map(prevByKey);
const put = (e) => {
  if (!e) return;
  const key = `${e.type}:${e.id}`;
  const old = prevByKey.get(key);
  const strip = (x) => JSON.stringify({ ...x, generated_at: undefined });
  e.generated_at = old && strip(old) === strip(e) ? old.generated_at : new Date().toISOString();
  out.set(key, e);
};

if (latestDate) {
  const weekOf = (d) => {
    const mon = mondayOf(d);
    return { id: isoWeekId(mon), start: mon, end: addDays(mon, 4) };
  };
  // current week: always rebuilt (period_end = last close so far)
  const cur = weekOf(latestDate);
  const curEntry = build('week', cur.id, cur.start, cur.end <= latestDate ? cur.end : latestDate);
  if (curEntry) {
    if (latestDate < cur.end) curEntry.partial = true;
    put(curEntry);
  }
  // older weeks: create once if missing
  let m = mondayOf(usSnaps[0].date);
  while (m < cur.start) {
    const w = weekOf(m);
    const key = `week:${w.id}`;
    if (!prevByKey.has(key)) {
      const e = build('week', w.id, w.start, w.end);
      if (e) put(e);
    }
    m = addDays(m, 7);
  }
  // months
  const first = usSnaps[0].date;
  let y = Number(first.slice(0, 4));
  let mo = Number(first.slice(5, 7));
  const ly = Number(latestDate.slice(0, 4));
  const lm = Number(latestDate.slice(5, 7));
  while (y < ly || (y === ly && mo <= lm)) {
    const ltd = lastTradingDay(y, mo);
    const id = `${y}-${String(mo).padStart(2, '0')}`;
    const key = `month:${id}`;
    const hasEnd = usSnaps.some((s) => s.date === ltd);
    const isTrigger = latestDate === ltd;
    if (hasEnd && (isTrigger || !prevByKey.has(key))) {
      const e = build('month', id, `${id}-01`, ltd);
      if (e) put(e);
    }
    mo++;
    if (mo > 12) {
      mo = 1;
      y++;
    }
  }
}

const list = [...out.values()].sort(
  (a, b) => b.period_end.localeCompare(a.period_end) || (a.type === 'month' ? -1 : 1)
);
if (writeIfChanged(path.join(DATA, 'summaries.json'), list)) changed = true;

console.log(
  `${list.length} summaries: ` + list.map((e) => `${e.type}:${e.id}`).join(', ')
);
console.log(changed ? (DRY ? 'SUMMARIES_CHANGED (dry-run, nothing written)' : 'SUMMARIES_CHANGED') : 'SUMMARIES_UP_TO_DATE');
