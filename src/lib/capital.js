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

/**
 * @param {'week'|'month'} kind
 * @returns {{pnl:number, pct:number|null, startVal:number, from:string, n:number}|null}
 */
export function computePeriod(checkins, total, capital, kind) {
  const series = (checkins && checkins.series) || [];
  if (!series.length || total == null || !Number.isFinite(total)) return null;
  const rows = series
    .filter((r) => r && r.date && Number.isFinite(Number(r.pnl)))
    .map((r) => ({ close: closeDateOf(r), pnl: Number(r.pnl) }))
    .sort((a, b) => a.close.localeCompare(b.close));
  if (!rows.length) return null;

  const ref = rows[rows.length - 1].close; // latest covered close
  const [y, m, d] = ref.split('-').map(Number);
  const refDt = new Date(y, m - 1, d);
  let from;
  if (kind === 'week') {
    const back = (refDt.getDay() + 6) % 7; // days since Monday
    const mon = new Date(refDt);
    mon.setDate(mon.getDate() - back);
    from = iso(mon);
  } else {
    from = iso(new Date(y, m - 1, 1));
  }
  const inPeriod = rows.filter((r) => r.close >= from);
  if (!inPeriod.length) return null;
  const pnl = inPeriod.reduce((s, r) => s + r.pnl, 0);
  const dep = ((capital && capital.deposits) || [])
    .filter((x) => x.date >= from)
    .reduce((s, x) => s + x.amount_usd, 0);
  const startVal = total - pnl - dep;
  return { pnl, pct: startVal > 0 ? (pnl / startVal) * 100 : null, startVal, from, n: inPeriod.length };
}
