#!/usr/bin/env node
/**
 * generate-13f.mjs — 13F 追踪数据（public/data/13f/<id>.json + index.json）
 *
 * Usage:  npm run 13f            # 全部机构
 *         npm run 13f -- berkshire pershing   # 只更新指定 id
 *
 * 数据全部来自 SEC EDGAR（免 key，需 User-Agent）：
 *   data.sec.gov/submissions/CIK##########.json        → 申报列表（13F-HR / 13F-HR/A）
 *   www.sec.gov/Archives/edgar/data/<cik>/<acc>/index.json → 找 infotable.xml / primary_doc.xml
 *   www.sec.gov/files/company_tickers.json              → 发行人名称 → ticker（尽力映射）
 * 环境变量：SEC_CONTACT_EMAIL（写进 User-Agent，默认占位）、SEC_USER_AGENT（整串覆盖）
 * 限速：全局 ≤ 8 req/s（SEC 上限 10）。
 *
 * 口径：
 *  - 每家拉最近 6 个季度（多拉 1 个季度只用于计算最老一期的变化）。
 *  - 同一季度若有 13F-HR/A：RESTATEMENT 覆盖原申报；NEW HOLDINGS 追加到原申报。
 *  - 同 CUSIP（+ 股数类型 SH/PRN）的重复行合并（伯克希尔按子公司拆行）。
 *  - putCall 为 Put/Call 的期权行单独放 options[]，不计入 total_value_usd / pct。
 *  - change 按「股数」对比相邻季度：new / add / trim / exit / unchanged（|Δ| ≤ 2% 视为 unchanged）；
 *    exited[] = 上季有、本季没有的持仓。市值涨跌不等于买卖。
 *  - 每季只保留市值前 MAX_HOLDINGS 只，其余合并成 other{n,value,pct}（变化先算后截）。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/data/13f');

const UA =
  process.env.SEC_USER_AGENT || `CryptoTrix 13F tracker ${process.env.SEC_CONTACT_EMAIL || 'contact@example.com'}`;
const QUARTERS_SHOWN = 6;
const MAX_HOLDINGS = 120;
const MAX_EXITED = 40;
const CHANGE_THRESHOLD = 0.02;
const MIN_GAP_MS = 130; // ≤ 8 req/s

// ── 机构配置：名单 / 中文名 / 掌门人 / CIK / 品牌色（首字母徽章用，不用真人肖像）──────────
export const INSTITUTIONS = [
  { id: 'berkshire', name: 'Berkshire Hathaway', name_cn: '伯克希尔', manager: 'Greg Abel（前任 Warren Buffett）', cik: '0001067983', initials: 'BH', color: '#4C8DF7' },
  { id: 'tci', name: 'TCI Fund Management', name_cn: 'TCI', manager: 'Chris Hohn', cik: '0001647251', initials: 'TCI', color: '#0ECB81' },
  { id: 'coatue', name: 'Coatue Management', name_cn: 'Coatue', manager: 'Philippe Laffont', cik: '0001135730', initials: 'CT', color: '#A06BFF' },
  { id: 'pif', name: 'Public Investment Fund', name_cn: '沙特 PIF', manager: 'Yasir Al-Rumayyan（Governor）', cik: '0001767640', initials: 'PIF', color: '#22C7D6' },
  { id: 'temasek', name: 'Temasek Holdings', name_cn: '淡马锡', manager: 'Dilhan Pillay（CEO）', cik: '0001021944', initials: 'TM', color: '#FF6B6B' },
  { id: 'bridgewater', name: 'Bridgewater Associates', name_cn: '桥水', manager: 'Ray Dalio（创办人，已退一线）', cik: '0001350694', initials: 'BW', color: '#5B5FEF' },
  { id: 'tiger', name: 'Tiger Global Management', name_cn: '老虎环球', manager: 'Chase Coleman', cik: '0001167483', initials: 'TG', color: '#FF8A3D' },
  { id: 'elliott', name: 'Elliott Investment Management', name_cn: 'Elliott', manager: 'Paul Singer', cik: '0001791786', initials: 'EL', color: '#E573B5' },
  { id: 'hh', name: 'H&H International Investment', name_cn: 'H&H（段永平）', manager: '段永平', cik: '0001759760', initials: 'HH', color: '#F0B90B' },
  { id: 'ark', name: 'ARK Investment Management', name_cn: 'ARK', manager: 'Cathie Wood', cik: '0001697748', initials: 'ARK', color: '#8FD14F' },
  { id: 'pershing', name: 'Pershing Square Capital Management', name_cn: '潘兴广场', manager: 'Bill Ackman', cik: '0001336528', also_ciks: ['0002026053'], initials: 'PS', color: '#2E9E8F' },
  { id: 'appaloosa', name: 'Appaloosa LP', name_cn: 'Appaloosa', manager: 'David Tepper', cik: '0001656456', initials: 'AP', color: '#C9A27A' },
  { id: 'duquesne', name: 'Duquesne Family Office', name_cn: 'Duquesne', manager: 'Stanley Druckenmiller', cik: '0001536411', initials: 'DQ', color: '#9BB7D4' },
  { id: 'thirdpoint', name: 'Third Point', name_cn: 'Third Point', manager: 'Dan Loeb', cik: '0001040273', initials: 'TP', color: '#D9D26A' },
  { id: 'dme', name: 'DME Capital Management (Greenlight)', name_cn: 'DME / Greenlight', manager: 'David Einhorn', cik: '0001489933', initials: 'DME', color: '#7FE0B5' },
  { id: 'himalaya', name: 'Himalaya Capital Management', name_cn: '喜马拉雅（李录）', manager: '李录 Li Lu', cik: '0001709323', initials: 'HC', color: '#B07A5B' },
  { id: 'oriental', name: 'Oriental Harbor', name_cn: '东方港湾（但斌）', manager: '但斌', cik: '0002046333', initials: 'OH', color: '#FF6B9D' },
];

// ── ticker 覆盖表（CUSIP → [ticker, 显示名]）：SEC 名称映射不可靠的 ETF / 多股类别 / 简称 ──
// CUSIP 来自各家 13F 原始数据（脚本会打印未命中比例；新增时对照 infotable 里的 nameOfIssuer 确认）
const CUSIP_OVERRIDE = {
  '02079K107': ['GOOG', 'Alphabet (C)'],
  '02079K305': ['GOOGL', 'Alphabet (A)'],
  '084670702': ['BRK.B', 'Berkshire Hathaway (B)'],
  '78462F103': ['SPY', 'SPDR S&P 500 ETF'],
  '464287200': ['IVV', 'iShares Core S&P 500 ETF'],
  '922908363': ['VOO', 'Vanguard S&P 500 ETF'],
  '46090E103': ['QQQ', 'Invesco QQQ'],
  '874039100': ['TSM', 'Taiwan Semiconductor (ADR)'],
  'H1467J104': ['CB', 'Chubb'],
  '060505104': ['BAC', 'Bank of America'], '369604301': ['GE', 'GE Aerospace'], '285512109': ['EA', 'Electronic Arts'],
  '829933100': ['SIRI', 'SiriusXM'], '11271J107': ['BN', 'Brookfield Corp'], '92343E102': ['VRSN', 'VeriSign'],
  '57636Q104': ['MA', 'Mastercard'], '42824C109': ['HPE', 'Hewlett Packard Enterprise'], 'N3168P101': ['FER', 'Ferrovial'],
  '650111107': ['NYT', 'New York Times'], '844741108': ['LUV', 'Southwest Airlines'], '136375102': ['CNI', 'Canadian National Railway'],
  '64110L106': ['NFLX', 'Netflix'], 'N07059210': ['ASML', 'ASML Holding'], '464286772': ['EWY', 'iShares MSCI South Korea ETF'],
  '03769M106': ['APO', 'Apollo Global Management'], '46641Q837': ['JPST', 'JPMorgan Ultra-Short Income ETF'], '31946M103': ['FCNCA', 'First Citizens BancShares'],
  'G7997R103': ['STX', 'Seagate Technology'], 'G25508105': ['CRH', 'CRH plc'], '36266G107': ['GEHC', 'GE HealthCare'],
  '538034109': ['LYV', 'Live Nation'], '655844108': ['NSC', 'Norfolk Southern'], '254687106': ['DIS', 'Walt Disney'],
  '922042858': ['VWO', 'Vanguard FTSE Emerging Markets ETF'], '46138E628': ['KBWB', 'Invesco KBW Bank ETF'], '219350105': ['GLW', 'Corning'],
  '464286400': ['EWZ', 'iShares MSCI Brazil ETF'], '464288588': ['MBB', 'iShares MBS ETF'], '00404A109': ['ACHC', 'Acadia Healthcare'],
  '34964C106': ['FBIN', 'Fortune Brands Innovations'], '464287242': ['LQD', 'iShares iBoxx IG Corporate Bond ETF'], '46434G103': ['IEMG', 'iShares Core MSCI Emerging Markets ETF'],
  '910047109': ['UAL', 'United Airlines'], '71654V408': ['PBR', 'Petrobras (ADR)'], '68278B107': ['OS', 'OneStream'],
  '85208M102': ['SFM', 'Sprouts Farmers Market'], '12541W209': ['CHRW', 'C.H. Robinson'], 'V5633W109': ['MMYT', 'MakeMyTrip'],
  '042068205': ['ARM', 'Arm Holdings (ADR)'], '872540109': ['TJX', 'TJX Companies'], '500767306': ['KWEB', 'KraneShares CSI China Internet ETF'],
  '26875P101': ['EOG', 'EOG Resources'], '92189F106': ['GDX', 'VanEck Gold Miners ETF'], '099502106': ['BAH', 'Booz Allen Hamilton'],
  '806407102': ['HSIC', 'Henry Schein'], '174610105': ['CFG', 'Citizens Financial Group'], '093671105': ['HRB', 'H&R Block'],
  '23331A109': ['DHI', 'D.R. Horton'], 'N20944109': ['CNH', 'CNH Industrial'], '989207105': ['ZBRA', 'Zebra Technologies'],
  '302520101': ['FNB', 'F.N.B. Corp'], '92857W308': ['VOD', 'Vodafone (ADR)'], '29273V100': ['ET', 'Energy Transfer'],
  '064058100': ['BK', 'BNY Mellon'], '929740108': ['WAB', 'Wabtec'], '37954Y830': ['COPX', 'Global X Copper Miners ETF'],
  '674599105': ['OXY', 'Occidental Petroleum'], '382550101': ['GT', 'Goodyear Tire'], '47233W109': ['JEF', 'Jefferies Financial'],
  '14040H105': ['COF', 'Capital One'], '55616P104': ['M', "Macy's"], '46137V357': ['RSP', 'Invesco S&P 500 Equal Weight ETF'],
  '92189F676': ['SMH', 'VanEck Semiconductor ETF'], '07782B104': ['BLTE', 'Belite Bio (ADR)'], '06849F108': ['B', 'Barrick Mining'],
};
// 名称前缀覆盖（SEC 标题对不上的简称）
const NAME_OVERRIDE = [
  [/^TAIWAN SEMICONDUCTOR/, 'TSM', 'Taiwan Semiconductor (ADR)'],
  [/^ALIBABA GROUP/, 'BABA', 'Alibaba'],
  [/^PDD HOLDINGS/, 'PDD', 'PDD Holdings'],
  [/^BAIDU/, 'BIDU', 'Baidu'],
  [/^SPACE EXPLORATION/, null, 'SpaceX (未上市)'],
  [/^UNITED STATES OIL/, 'USO', 'United States Oil Fund'],
];
const CN_NAMES = {
  AAPL: '苹果', MSFT: '微软', NVDA: '英伟达', AMZN: '亚马逊', GOOGL: '谷歌 A', GOOG: '谷歌 C', META: 'Meta', TSLA: '特斯拉',
  'BRK.B': '伯克希尔 B', KO: '可口可乐', AXP: '美国运通', BAC: '美国银行', CVX: '雪佛龙', OXY: '西方石油', MCO: '穆迪', CB: '安达保险',
  TSM: '台积电', AVGO: '博通', MU: '美光', AMD: 'AMD', INTC: '英特尔', PDD: '拼多多', BABA: '阿里巴巴', V: 'Visa', MA: '万事达',
  JPM: '摩根大通', LLY: '礼来', NFLX: '奈飞', UBER: '优步', GE: '通用电气', ORCL: '甲骨文', CRM: 'Salesforce', ADBE: 'Adobe',
};

// ── 请求（全局限速）────────────────────────────────────────────────────────────────
let lastReq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttled() {
  const wait = lastReq + MIN_GAP_MS - Date.now();
  lastReq = Math.max(Date.now(), lastReq + MIN_GAP_MS);
  if (wait > 0) await sleep(wait);
}
async function get(url, { json = false, retries = 3 } = {}) {
  let err;
  for (let i = 0; i < retries; i++) {
    await throttled();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status + ' ' + url), { fatal: true });
      return json ? await r.json() : await r.text();
    } catch (e) {
      err = e;
      if (e.fatal) break;
      await sleep(2000 * (i + 1));
    }
  }
  throw err;
}

// ── 解析 ─────────────────────────────────────────────────────────────────────────
const stripNs = (x) => x.replace(/<(\/?)[A-Za-z0-9_.-]+:/g, '<$1').replace(/\sxmlns(:[\w.-]+)?="[^"]*"/g, '');
const tag = (block, t) => {
  const m = block.match(new RegExp(`<${t}>\\s*([\\s\\S]*?)\\s*</${t}>`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
};

function parseInfoTable(xml) {
  const x = stripNs(xml);
  const rows = [];
  for (const m of x.matchAll(/<infoTable>([\s\S]*?)<\/infoTable>/gi)) {
    const b = m[1];
    const sh = b.match(/<shrsOrPrnAmt>([\s\S]*?)<\/shrsOrPrnAmt>/i)?.[1] || '';
    const value = Number(tag(b, 'value').replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    rows.push({
      name: tag(b, 'nameOfIssuer'),
      cls: tag(b, 'titleOfClass'),
      cusip: tag(b, 'cusip').toUpperCase(),
      value,
      shares: Number(tag(sh, 'sshPrnamt').replace(/,/g, '')) || 0,
      sh_type: tag(sh, 'sshPrnamtType') || 'SH',
      put_call: tag(b, 'putCall') || null,
    });
  }
  return rows;
}

// ── ticker 映射 ───────────────────────────────────────────────────────────────────
const STOP = new Set(['INC', 'CORP', 'CORPORATION', 'CO', 'COM', 'LTD', 'LIMITED', 'PLC', 'HLDGS', 'HOLDINGS', 'HLDG', 'GROUP', 'GRP', 'THE', 'NEW', 'DEL', 'NV', 'SA', 'AG', 'LP', 'LLC', 'COMPANY', 'CL', 'CLASS', 'ORD', 'ADS', 'ADR', 'SHS', 'N', 'V', 'DE', 'INCORPORATED', 'SE', 'SHS', 'COMMON', 'STOCK']);
const ABBR = { PETE: 'PETROLEUM', FINL: 'FINANCIAL', INTL: 'INTERNATIONAL', TECHN: 'TECHNOLOGIES', TECH: 'TECHNOLOGIES', TECHNOLOGY: 'TECHNOLOGIES', MFG: 'MANUFACTURING', BK: 'BANK', RUBR: 'RUBBER', SVCS: 'SERVICES', SYS: 'SYSTEMS', PHARMACEUTICAL: 'PHARMACEUTICALS', PHARMA: 'PHARMACEUTICALS', LABS: 'LABORATORIES', ENERGY: 'ENERGY', RESOURCES: 'RESOURCES', ENTMT: 'ENTERTAINMENT', COMMUNICATIONS: 'COMMUNICATIONS', COMMUNICATION: 'COMMUNICATIONS', COMMS: 'COMMUNICATIONS', MKTS: 'MARKETS', AMERN: 'AMERICAN', NATL: 'NATIONAL', INDS: 'INDUSTRIES', IND: 'INDUSTRIES', STORES: 'STORES', PPTYS: 'PROPERTIES', PRODS: 'PRODUCTS', MATLS: 'MATERIALS', ELECTRS: 'ELECTRONICS', ELEC: 'ELECTRIC', HEALTHCARE: 'HEALTH', HLTH: 'HEALTH' };
const norm = (s) =>
  String(s).toUpperCase().replace(/&/g, ' AND ').replace(/['’]/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => ABBR[w] || w).join(' ');

function buildTickerIndex(raw) {
  const byName = new Map();
  const list = [];
  for (const k of Object.keys(raw)) {
    const e = raw[k];
    const n = norm(e.title);
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, { ticker: e.ticker, title: e.title });
    list.push([n, { ticker: e.ticker, title: e.title }]);
  }
  return { byName, list };
}

function prettyName(s) {
  const small = new Set(['INC', 'CORP', 'CO', 'LTD', 'PLC', 'LP', 'LLC', 'ETF', 'ADR', 'ADS', 'NV', 'SA', 'AG', 'REIT', 'USA', 'US', 'SPDR', 'CL', 'II', 'III', 'IV']);
  return s
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (small.has(w.toUpperCase()) ? (w.length <= 2 ? w.toUpperCase() : w.charAt(0) + w.slice(1).toLowerCase()) : w.length <= 3 && /^[A-Z&]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

const fixName = (x) => x.replace(/^Amazon Com Inc/i, 'Amazon.com Inc').replace(/^Wix Com /i, 'Wix.com ').replace(/^Monday Com /i, 'monday.com ');
const tidy = (t) => {
  const x = String(t).replace(/\s+/g, ' ').replace(/\s*\/[A-Z]{2,4}\/?$/, '').trim();
  return fixName(x === x.toUpperCase() ? prettyName(x) : x);
};

function mapTicker(row, idx) {
  const o = CUSIP_OVERRIDE[row.cusip];
  if (o) return { ticker: o[0], display: o[1], via: 'cusip' };
  for (const [re, t, d] of NAME_OVERRIDE) if (re.test(row.name.toUpperCase())) return { ticker: t, display: d, via: 'name-override' };
  const n = norm(row.name);
  if (!n) return { ticker: null, display: prettyName(row.name), via: null };
  const hit = idx.byName.get(n);
  if (hit && !/ETF|TRUST|TR$/.test(row.name.toUpperCase())) return { ticker: hit.ticker, display: tidy(hit.title), via: 'sec' };
  // 13F 名称常被截断（≤30 字符）：唯一前缀命中才采纳
  if (n.length >= 9) {
    const c = idx.list.filter(([k]) => k.startsWith(n));
    const uniq = [...new Set(c.map(([, v]) => v.ticker))];
    if (uniq.length === 1 || (c.length && new Set(c.map(([k]) => k)).size === 1)) return { ticker: c[0][1].ticker, display: tidy(c[0][1].title), via: 'sec-prefix' };
  }
  const etf = /^(ISHARES|SPDR|VANGUARD|INVESCO|SELECT SECTOR|PROSHARES|DIREXION|WISDOMTREE|GLOBAL X|KRANESHARES|FIRST TR|FLEXSHARES|VANECK|ISHARES)/.test(row.name.toUpperCase());
  return { ticker: null, display: etf && row.cls ? `${prettyName(row.name)} ${row.cls}` : prettyName(row.name), via: null };
}

// ── 单个机构 ──────────────────────────────────────────────────────────────────────
async function filingXmls(cikInt, acc) {
  const accNo = acc.replace(/-/g, '');
  const idx = await get(`https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNo}/index.json`, { json: true });
  const xmls = idx.directory.item.filter((i) => i.name.toLowerCase().endsWith('.xml'));
  const info = xmls.filter((i) => i.name.toLowerCase() !== 'primary_doc.xml').sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0];
  return { base: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNo}/`, info: info?.name, primary: xmls.find((i) => i.name.toLowerCase() === 'primary_doc.xml')?.name };
}

async function collectFilings(inst) {
  const rows = [];
  const entities = [];
  // also_ciks：同一投资团队换过申报主体（如 Pershing Square Inc.），按季度合并
  for (const cik of [inst.cik, ...(inst.also_ciks || [])]) {
    const cik10 = cik.padStart(10, '0');
    const cikInt = Number(cik);
    const sub = await get(`https://data.sec.gov/submissions/CIK${cik10}.json`, { json: true });
    entities.push(sub.name);
    const mine = [];
    const push = (r) => {
      for (let i = 0; i < r.form.length; i++) {
        if (r.form[i] === '13F-HR' || r.form[i] === '13F-HR/A') mine.push({ form: r.form[i], acc: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i], cik: cikInt, entity: sub.name });
      }
    };
    push(sub.filings.recent);
    for (const f of sub.filings.files || []) {
      if (new Set(mine.map((r) => r.period)).size >= QUARTERS_SHOWN + 1) break;
      push(await get(`https://data.sec.gov/submissions/${f.name}`, { json: true }));
    }
    rows.push(...mine);
  }
  return { entity: entities.join(' + '), rows };
}

async function loadOneFiler(items) {
  // items: 同一申报人、同一报告期的申报。原申报 + 修正（RESTATEMENT 覆盖 / NEW HOLDINGS 追加）
  const sorted = items.slice().sort((a, b) => a.filed.localeCompare(b.filed) || a.acc.localeCompare(b.acc));
  let base = null;
  const extra = [];
  const notes = [];
  for (const f of sorted) {
    const x = await filingXmls(f.cik, f.acc);
    if (!x.info) continue;
    let amendType = null;
    if (f.form === '13F-HR/A' && x.primary) {
      const p = stripNs(await get(x.base + x.primary));
      amendType = (tag(p, 'amendmentType') || '').toUpperCase();
    }
    const rows = parseInfoTable(await get(x.base + x.info));
    if (!rows.length) continue;
    // 个别申报人（如 Duquesne）以「千美元」填 value：用前 10 大行的隐含股价中位数判断
    const px = rows.filter((r) => r.sh_type === 'SH' && r.shares > 0).sort((a, b) => b.value - a.value).slice(0, 10).map((r) => r.value / r.shares).sort((a, b) => a - b);
    if (px.length && px[Math.floor(px.length / 2)] < 2) {
      for (const r of rows) r.value *= 1000;
      notes.push(`value 按千美元申报，已 ×1000（${f.form} ${f.filed}）`);
    }
    if (f.form === '13F-HR') {
      base = { f, rows };
    } else if (amendType.includes('NEW')) {
      extra.push({ f, rows });
      notes.push(`13F-HR/A 追加（${f.filed}）`);
    } else {
      base = { f, rows }; // RESTATEMENT（或未标注：按覆盖处理）
      extra.length = 0;
      notes.push(`13F-HR/A 覆盖（${f.filed}）`);
    }
  }
  if (!base) return null;
  return { filed: base.f.filed, acc: base.f.acc, entity: base.f.entity, rows: base.rows.concat(...extra.map((e) => e.rows)), notes };
}

async function loadPeriod(inst, items) {
  // 同一报告期可能来自多个申报人（also_ciks）：各自处理后合并持仓
  const byCik = new Map();
  for (const f of items) {
    if (!byCik.has(f.cik)) byCik.set(f.cik, []);
    byCik.get(f.cik).push(f);
  }
  const parts = [];
  for (const list of byCik.values()) {
    const l = await loadOneFiler(list);
    if (l) parts.push(l);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  parts.sort((a, b) => b.rows.length - a.rows.length);
  return {
    filed: parts.map((p) => p.filed).sort().pop(),
    acc: parts.map((p) => p.acc).join(' + '),
    entity: parts.map((p) => p.entity).join(' + '),
    rows: parts.flatMap((p) => p.rows),
    notes: [...parts.flatMap((p) => p.notes), `合并 ${parts.length} 个申报主体的 13F-HR`],
  };
}

function aggregate(rows) {
  const hold = new Map();
  const opts = new Map();
  for (const r of rows) {
    const isOpt = r.put_call && /put|call/i.test(r.put_call);
    const m = isOpt ? opts : hold;
    const key = isOpt ? `${r.cusip}|${r.put_call}` : `${r.cusip}|${r.sh_type}`;
    const o = m.get(key);
    if (o) {
      o.value += r.value;
      o.shares += r.shares;
    } else m.set(key, { ...r });
  }
  return { hold, opts };
}

function buildQuarter(inst, period, loaded, prevAgg, idx, stats) {
  const { hold, opts } = aggregate(loaded.rows);
  const total = [...hold.values()].reduce((s, r) => s + r.value, 0);
  const all = [...hold.entries()].sort((a, b) => b[1].value - a[1].value);
  const counts = { new: 0, add: 0, trim: 0, exit: 0, unchanged: 0 };
  const mk = ([key, r]) => {
    const t = mapTicker(r, idx);
    stats.total++;
    stats.totalValue += r.value;
    if (t.ticker) stats.mapped++;
    else stats.unmappedValue += r.value;
    const out = {
      cusip: r.cusip,
      ticker: t.ticker,
      name: t.display,
      cn: t.ticker ? CN_NAMES[t.ticker] || null : null,
      issuer: r.name,
      cls: r.cls,
      sh_type: r.sh_type,
      shares: r.shares,
      value: Math.round(r.value),
      pct: total ? +((r.value / total) * 100).toFixed(3) : 0,
    };
    if (prevAgg) {
      const p = prevAgg.hold.get(key);
      if (!p) {
        out.change = { type: 'new', d_shares: r.shares, prev_shares: 0, d_pct: null };
      } else {
        const d = r.shares - p.shares;
        const rel = p.shares ? d / p.shares : 0;
        const type = Math.abs(rel) <= CHANGE_THRESHOLD ? 'unchanged' : d > 0 ? 'add' : 'trim';
        out.change = { type, d_shares: d, prev_shares: p.shares, d_pct: p.shares ? +(rel * 100).toFixed(2) : null };
      }
      counts[out.change.type]++;
    }
    return out;
  };
  const mapped = all.map(mk);
  const holdings = mapped.slice(0, MAX_HOLDINGS);
  const rest = mapped.slice(MAX_HOLDINGS);
  const other = rest.length ? { n: rest.length, value: rest.reduce((s, h) => s + h.value, 0), pct: +rest.reduce((s, h) => s + h.pct, 0).toFixed(3) } : null;

  let exited = null;
  if (prevAgg) {
    exited = [];
    for (const [key, p] of prevAgg.hold) {
      if (!hold.has(key)) {
        const t = mapTicker(p, idx);
        exited.push({ cusip: p.cusip, ticker: t.ticker, name: t.display, cn: t.ticker ? CN_NAMES[t.ticker] || null : null, issuer: p.name, prev_shares: p.shares, prev_value: Math.round(p.value) });
      }
    }
    exited.sort((a, b) => b.prev_value - a.prev_value);
    counts.exit = exited.length;
  }
  const options = [...opts.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 30)
    .map((r) => {
      const t = mapTicker(r, idx);
      return { cusip: r.cusip, ticker: t.ticker, name: t.display, issuer: r.name, put_call: r.put_call, shares: r.shares, value: Math.round(r.value) };
    });
  return {
    period,
    filing_date: loaded.filed,
    accession: loaded.acc,
    filer: loaded.entity,
    amendment: loaded.notes.length ? loaded.notes.join('；') : null,
    total_value_usd: Math.round(total),
    n_positions: hold.size,
    options_n: opts.size,
    options_value_usd: Math.round([...opts.values()].reduce((s, r) => s + r.value, 0)),
    counts: prevAgg ? counts : null,
    prev_period: prevAgg ? prevAgg.period : null,
    holdings,
    other,
    exited: exited ? exited.slice(0, MAX_EXITED) : null,
    exited_n: exited ? exited.length : null,
    options,
  };
}

async function runInstitution(inst, idx, stats) {
  const { entity, rows } = await collectFilings(inst);
  const byPeriod = new Map();
  for (const r of rows) {
    if (!r.period) continue;
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
    byPeriod.get(r.period).push(r);
  }
  const periods = [...byPeriod.keys()].sort().reverse().slice(0, QUARTERS_SHOWN + 1); // 新→旧
  if (!periods.length) throw new Error('无 13F-HR 申报');
  const loaded = [];
  for (const p of periods) {
    const l = await loadPeriod(inst, byPeriod.get(p));
    if (l) loaded.push({ period: p, ...l, agg: aggregate(l.rows) });
  }
  if (!loaded.length) throw new Error('infotable 解析为空');
  const quarters = [];
  for (let i = 0; i < Math.min(QUARTERS_SHOWN, loaded.length); i++) {
    const prev = loaded[i + 1] ? { ...loaded[i + 1].agg, period: loaded[i + 1].period } : null;
    quarters.push(buildQuarter(inst, loaded[i].period, loaded[i], prev, idx, stats));
  }
  return {
    id: inst.id,
    name: inst.name,
    name_cn: inst.name_cn,
    manager: inst.manager,
    cik: inst.cik,
    initials: inst.initials,
    color: inst.color,
    sec_entity: entity,
    generated_at: new Date().toISOString(),
    source: 'SEC EDGAR 13F-HR',
    source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${inst.cik}&type=13F-HR`,
    quarters,
  };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const list = only.length ? INSTITUTIONS.filter((i) => only.includes(i.id)) : INSTITUTIONS;
  await mkdir(OUT_DIR, { recursive: true });
  const idx = buildTickerIndex(await get('https://www.sec.gov/files/company_tickers.json', { json: true }));
  const stats = { total: 0, mapped: 0, totalValue: 0, unmappedValue: 0 };

  let oldIndex = {};
  try {
    for (const i of JSON.parse(await readFile(resolve(OUT_DIR, 'index.json'), 'utf8')).institutions) oldIndex[i.id] = i;
  } catch { /* first run */ }

  const summary = [];
  for (const inst of INSTITUTIONS) {
    if (!list.includes(inst)) {
      if (oldIndex[inst.id]) summary.push(oldIndex[inst.id]);
      continue;
    }
    try {
      const data = await runInstitution(inst, idx, stats);
      await writeFile(resolve(OUT_DIR, `${inst.id}.json`), JSON.stringify(data) + '\n');
      const q = data.quarters[0];
      summary.push({ id: inst.id, name: inst.name, name_cn: inst.name_cn, manager: inst.manager, cik: inst.cik, initials: inst.initials, color: inst.color, status: 'ok', quarters: data.quarters.length, latest_period: q.period, latest_filing_date: q.filing_date, latest_value_usd: q.total_value_usd, latest_n: q.n_positions });
      console.log(`✓ ${inst.id.padEnd(11)} ${data.quarters.length}Q  latest ${q.period} filed ${q.filing_date}  $${(q.total_value_usd / 1e9).toFixed(2)}B  ${q.n_positions} pos  opts ${q.options_n}${q.amendment ? '  [' + q.amendment + ']' : ''}`);
    } catch (e) {
      console.warn(`✗ ${inst.id}: ${e.message}`);
      summary.push({ id: inst.id, name: inst.name, name_cn: inst.name_cn, manager: inst.manager, cik: inst.cik, initials: inst.initials, color: inst.color, status: 'missing', error: e.message, quarters: 0 });
    }
  }
  await writeFile(
    resolve(OUT_DIR, 'index.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), source: 'SEC EDGAR', ticker_map_coverage: stats.total ? { positions: stats.total, mapped: stats.mapped, mapped_pct: +((stats.mapped / stats.total) * 100).toFixed(1), value_mapped_pct: +((1 - stats.unmappedValue / stats.totalValue) * 100).toFixed(1) } : null, institutions: summary }, null, 1) + '\n'
  );
  if (stats.total) console.log(`ticker 映射：${stats.mapped}/${stats.total} 条持仓（${((stats.mapped / stats.total) * 100).toFixed(1)}%），按市值 ${((1 - stats.unmappedValue / stats.totalValue) * 100).toFixed(1)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
