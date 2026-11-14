#!/usr/bin/env node
/**
 * sync-checkins.mjs — parse Portfolio_Daily_*.md reports into fund-checkins.json.
 *
 * Part of the CryptoTrix public-site auto-sync (launchd job calls the bash
 * wrapper scripts/sync-site.sh, which commits + deploys when this prints
 * a line containing "CHANGED").
 *
 * Env overrides (used by tests):
 *   MDS_DIR    — folder to scan for Portfolio_Daily_YYYYMMDD.md
 *   DATA_FILE  — path to fund-checkins.json
 *
 * Flags:
 *   --dry-run  — report what would change, write nothing
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MDS_DIR =
  process.env.MDS_DIR || path.join(os.homedir(), 'Downloads/CryptoTrix/portfolio-daily-tweet');
const DATA_FILE =
  process.env.DATA_FILE ||
  path.join(os.homedir(), 'Downloads/CryptoTrix/crypto-trix-public/public/data/fund-checkins.json');

const DRY = process.argv.includes('--dry-run');

/** Portfolio_Daily_20260919.md → 2026-09-19 (发稿日 = heatmap cell date). */
function dateFromFilename(name) {
  const m = /^Portfolio_Daily_(\d{4})(\d{2})(\d{2})\.md$/.exec(name);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * 当日盈亏 line → integer USD. Formats seen in the wild:
 *   当日盈亏：+$95            当日盈亏：🟢 +$1,234
 *   当日盈亏：🔴 -$647        当日盈亏：−$816（−0.44%）
 * Sign may be +, ASCII -, U+2212 −, en-dash –; amount may carry commas.
 */
function parsePnl(text) {
  // u flag is REQUIRED: the emoji class contains astral-plane chars, and
  // without /u the regex matches half a surrogate pair and never reaches the digits
  const m = /当日盈亏[：:]\s*(?:[🟢✅⚪❌🔴])?\s*([+−‑–—-])?\s*\$?\s*([\d,]+(?:\.\d+)?)/u.exec(text);
  if (!m) return null;
  const amt = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(amt)) return null;
  return m[1] && m[1] !== '+' ? -amt : amt;
}

/**
 * Market date the report's prices are "as of" — first ISO date on the
 * 价格截止 header line (e.g. "> 价格截止: 2026-09-25 美股收盘 …"). null when the
 * report uses a non-ISO form ("Aug 5 close", "8/6 收盘") or has no such line.
 */
function priceAsOf(text) {
  const line = /价格截止[^\n]*/.exec(text);
  const m = line && /(\d{4}-\d{2}-\d{2})/.exec(line[0]);
  return m ? m[1] : null;
}

/**
 * Header lines (类型 / 备注) that say the report just repeats the previous
 * session's numbers (weekend / holiday carry-forward).
 */
function declaresCarryForward(text) {
  return text
    .split('\n')
    .slice(0, 15)
    .some((l) => /^>\s*(类型|备注)/.test(l) && /周末休市·|沿用|无新成交|无周末交易/.test(l));
}

function parseDay(text) {
  const m = /\bDay\s*(\d+)\b/.exec(text);
  return m ? Number(m[1]) : null;
}

const json = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const series = Array.isArray(json.series) ? json.series : [];
const known = new Map(series.map((e) => [e.date, e]));

const files = fs
  .readdirSync(MDS_DIR)
  .filter((f) => dateFromFilename(f))
  .sort();

let added = 0;
const skipped = [];
// RULE: one series row per NEW US-market settlement. A daily report that only
// repeats an already-recorded close (weekend / holiday / pre-open Monday —
// same 价格截止 date as an earlier report, or header says 沿用/周末休市) must
// NOT create a row; it would copy the previous pnl and double-count it in the
// equity curve. See HANDOFF.md "Check-in series rule".
const seenAsOf = new Set();
for (const f of files) {
  const iso = dateFromFilename(f);
  const text = fs.readFileSync(path.join(MDS_DIR, f), 'utf8');
  const asOf = priceAsOf(text);
  const dupClose = asOf != null && seenAsOf.has(asOf);
  if (asOf != null) seenAsOf.add(asOf);
  if (known.has(iso)) continue;
  if (dupClose || declaresCarryForward(text)) {
    console.log(`~ ${iso}  skipped: no new settlement (${dupClose ? `prices still as of ${asOf}` : 'report declares carry-forward'})`);
    continue;
  }
  const pnl = parsePnl(text);
  if (pnl == null) {
    skipped.push(f);
    continue;
  }
  const entry = { date: iso, pnl };
  const day = parseDay(text);
  if (day != null) entry.day = day;
  series.push(entry);
  known.set(iso, entry);
  added++;
  console.log(`+ ${iso}  pnl=${pnl >= 0 ? '+' : ''}${pnl}${day != null ? `  day=${day}` : ''}`);
}

if (added === 0) {
  console.log('UP_TO_DATE');
  if (skipped.length) console.log(`(skipped ${skipped.length} md without a 当日盈亏 line)`);
  process.exit(0);
}

series.sort((a, b) => (a.date < b.date ? -1 : 1));
json.series = series;
json.as_of = series[series.length - 1].date;

if (DRY) {
  console.log(`DRY-RUN: would add ${added}, as_of → ${json.as_of}. Not writing.`);
} else {
  fs.writeFileSync(DATA_FILE, JSON.stringify(json, null, 2) + '\n');
  console.log(`CHANGED: added ${added}, series=${series.length}, as_of=${json.as_of}`);
}
