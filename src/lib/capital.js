/**
 * Account-level returns that account for deposits.
 *   YTD profit = total assets − start_of_year − deposits_total
 *   YTD %      = profit / (start_of_year + deposits_total)        (simple return on capital)
 *   WTD / MTD  = Σ daily pnl in the period (fund-checkins.json) / start-of-period value,
 *                start value ≈ total − Σpnl − deposits dated inside the period.
 * Inputs live in public/data/capital.json (+ fund-checkins.json); nothing is hardcoded.
 */

export async function loadCapital() {
  try {
    const res = await fetch('/data/capital.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const start = Number(j.start_of_year_usd);
    const dep = Number(j.deposits_total_usd);
    if (!Number.isFinite(start) || !Number.isFinite(dep)) throw new Error('bad capital.json');
    return {
      year: j.year ?? null,
      start_of_year_usd: start,
      deposits_total_usd: dep,
      fx_usdcny: Number(j.fx_usdcny) > 0 ? Number(j.fx_usdcny) : null,
      fx_as_of: j.fx_as_of || null,
      deposits: Array.isArray(j.deposits)
        ? j.deposits
            .map((d) => ({ date: String(d.date || ''), amount_usd: Number(d.amount_usd) }))
            .filter((d) => d.date && Number.isFinite(d.amount_usd))
        : [],
    };
  } catch {
    return null;
  }
}

let checkinsP = null;
export function loadCheckins() {
  if (!checkinsP) {
    checkinsP = fetch('/data/fund-checkins.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return checkinsP;
}

/** @returns {{base:number, profit:number, pct:number, start:number, deposits:number}|null} */
export function computeYtd(total, capital) {
  if (!capital || total == null || !Number.isFinite(total)) return null;
  const base = capital.start_of_year_usd + capital.deposits_total_usd;
  if (!(base > 0)) return null;
  const profit = total - base;
  return {
    base,
    profit,
    pct: (profit / base) * 100,
    start: capital.start_of_year_usd,
    deposits: capital.deposits_total_usd,
  };
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Market-close date a check-in row covers: explicit close_date, else the previous weekday of the post date. */
function closeDateOf(row) {
  if (row.close_date) return row.close_date;
  const [y, m, d] = row.date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  do {
    dt.setDate(dt.getDate() - 1);
  } while (dt.getDay() === 0 || dt.getDay() === 6);
  return iso(dt);
}

/** Today's calendar date in New York (the US session date), as YYYY-MM-DD. */
export function nyToday(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return p; // en-CA → YYYY-MM-DD
}

function periodStart(dateISO, kind) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (kind === 'week') {
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // back to Monday
    return iso(dt);
  }
  return iso(new Date(y, m - 1, 1));
}

/**
 * Account P&L for the week / month so far, deposit-aware, including the live session.
 *
 *   completed = Σ daily pnl from fund-checkins.json whose market-close date falls in the period
 *   live      = live total assets − snapshot total (holdings.json, which is the latest synced close),
 *               minus deposits dated after that close. Only added when a NEW US session exists
 *               (NY date is a weekday later than the latest checked-in close) — so weekends/holidays
 *               add 0 and a session already present in the check-ins is never counted twice.
 *   pnl       = completed + live
 *   start     = snapshot total − completed − deposits dated in [period start, latest close]
 *   pct       = pnl / start
 *
 * `ref` = { total, asOf } is the holdings.json snapshot. It is only trusted when ref.asOf equals the
 * latest check-in close date; otherwise (check-ins and snapshot out of step) we fall back to
 * check-ins only, anchored on `total`.
 *
 * @param {'week'|'month'} kind
 * @returns {{pnl:number, pct:number|null, startVal:number, from:string, n:number,
 *            live:number, liveIncluded:boolean, mode:'live'|'closed'|'checkins'}|null}
 */
export function computePeriod(checkins, total, capital, kind, ref = null, now = new Date()) {
  const series = (checkins && checkins.series) || [];
  if (!series.length || total == null || !Number.isFinite(total)) return null;
  const rows = series
    .filter((r) => r && r.date && Number.isFinite(Number(r.pnl)))
    .map((r) => ({ close: closeDateOf(r), pnl: Number(r.pnl) }))
    .sort((a, b) => a.close.localeCompare(b.close));
  if (!rows.length) return null;

  const latestClose = rows[rows.length - 1].close;
  const deps = (capital && capital.deposits) || [];
  const anchored =
    ref && Number.isFinite(ref.total) && ref.asOf && ref.asOf === latestClose;

  if (!anchored) {
    // check-ins only (legacy behaviour), anchored on the page total
    const from = periodStart(latestClose, kind);
    const inP = rows.filter((r) => r.close >= from);
    if (!inP.length) return null;
    const pnl = inP.reduce((s, r) => s + r.pnl, 0);
    const dep = deps.filter((x) => x.date >= from).reduce((s, x) => s + x.amount_usd, 0);
    const startVal = total - pnl - dep;
    return { pnl, pct: startVal > 0 ? (pnl / startVal) * 100 : null, startVal, from, n: inP.length,
      live: 0, liveIncluded: false, mode: 'checkins' };
  }

  const today = nyToday(now);
  const [ty, tm, td] = today.split('-').map(Number);
  const dow = new Date(ty, tm - 1, td).getDay();
  const newSession = dow >= 1 && dow <= 5 && today > latestClose;
  const anchorDate = newSession ? today : latestClose;
  const from = periodStart(anchorDate, kind);

  const inP = rows.filter((r) => r.close >= from);
  const completed = inP.reduce((s, r) => s + r.pnl, 0);
  const depBefore = deps
    .filter((x) => x.date >= from && x.date <= latestClose)
    .reduce((s, x) => s + x.amount_usd, 0);
  const depAfter = deps.filter((x) => x.date > latestClose).reduce((s, x) => s + x.amount_usd, 0);
  const live = newSession ? total - ref.total - depAfter : 0;
  const pnl = completed + live;
  const startVal = ref.total - completed - depBefore;
  if (!inP.length && !newSession) return null;
  return {
    pnl,
    pct: startVal > 0 ? (pnl / startVal) * 100 : null,
    startVal,
    from,
    n: inP.length,
    live,
    liveIncluded: newSession,
    mode: newSession ? 'live' : 'closed',
  };
}
