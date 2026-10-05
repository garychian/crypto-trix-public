# CryptoTrix Public — Handoff for Claude Code

> Owner: Changgui Qian / @CryptoTrix1 (garychian)  
> Last updated: 2026-09-21 (Asia/Shanghai)  
> Purpose: continue UI/data work on the **public** remake. Old site `https://crypto-trix.vercel.app` is **untouched** — do not overwrite it.

## Quick start

```bash
git clone https://github.com/garychian/crypto-trix-public.git
cd crypto-trix-public
git checkout feat/public-site
npm install
npm run dev          # http://localhost:5173/
npm run build        # must pass before deploy
```

**Prod:** https://crypto-trix-public.vercel.app/  
**Repo:** https://github.com/garychian/crypto-trix-public  
**Active branch:** `feat/public-site` (PR #1 may exist; main is still nearly empty placeholder)  
**Deploy:** `vercel deploy --prod --yes` from repo root (Vercel project `crypto-trix-public`, account that owns this project). Prefer deploying **this** project only.

## Stack

- Vite multi-page (vanilla JS/CSS, `"type": "module"`)
- Pages: `index.html`, `fund.html`, `options.html`, `cn-fund.html` (portfolio.html was merged into fund.html 2026-10-02; `/portfolio(.html)` 301 → `/fund.html` in `vercel.json`)
- Entry scripts under `src/*.js`; shared styles in `src/styles/`
- Serverless: `api/prices.js` — **must be ESM `export default`** (CJS `module.exports` breaks on Vercel with type:module)

## Site map / nav order

Top nav (`src/nav.js`):

1. 首页 `/`
2. 财富自由基金 `/fund.html`
3. 期权 `/options.html`
4. A股基金 `/cn-fund.html`

## Homepage layout (current, important)

Under site nav, inside `.hero-wrap`:

1. **打卡热力格** `#fund-checkin` — full-year 2026 GitHub-style P&L heatmap  
2. **`.dash-row`** (CSS grid, 3 cols ≥1101px / journey+VIX with yield card spanning below at 560–1100px / 1 col mobile):
   - **财富自由 · 旅程进度** concentric Activity rings `#journey-rings`
   - **恐慌贪婪指数** VIX gauge `#vix-gauge`
   - **美债十年期收益率** 10Y yield card `#yield10` (big readout + 90-day sparkline)
3. Then hero / feature cards / footer

Do **not** move the whole Fear & Greed block above the heatmap. The **14.81 readout** (value + VIX label, one row) sits **directly under the needle hub** — absolute, bottom-center of `.vix-gauge-visual` (`.vix-readout-under`), not in the card header.

### Journey rings (`src/journey-rings.js`)

Three rings (outer → inner):

| Ring | Meaning | Fill formula | Color |
|------|---------|--------------|-------|
| Outer | 旅程进度 → $2M | `total_assets_usd / goal_usd` | gold `#F0B90B` |
| Middle | 2026 年化 vs 目标 20% | `annualized_return_pct / annual_return_target_pct` | green `#0ECB81` |
| Inner | 现金占比 | `cash_usd / total_assets_usd` | blue `#5B8CFF` |

- Center of rings: **three progress % numbers** (same colors), count up on enter  
- Right side: **legend intro** (dot + label + value) — keep this; user wants it  
- Over 100% fill: darker overfill lap (Activity-style)

**User metrics (do not “fix” differently without asking):**

- `annualized_return_pct`: **15.12** — user-provided anchor (2026-09-22, alongside the
  $146,799 total). Implies equivalent compounding period **T ≈ 3.19y**
  (T = ln(1+53,264/93,975)/ln(1.1512) = 3.189). Chain daily with locked T:
  annualized = (1+cum/invested)^(1/3.189)−1. The old T≈3.89 (backed out of the
  even older 11.04% figure) is retired.
- `annual_return_target_pct`: **20** (2026 target)
- Cash (as of 9/22 close): broker-anchored chain — real total $146,799.22 (user,
  2026-09-22) + Tue pnl +$439.81 → total $147,239.03; cash = **$34,188.67**
  (unchanged, no trades); cum_pnl = 53,264; return 56.68%.
  The $32,038 (8/23) baseline is RETIRED — real cash was ~$34,188 through September.
  From now on: chain daily pnl from the last broker-anchored total, and ask for the
  broker total after any deposit/withdrawal/trade batch to re-anchor.

### Equity curve (`src/equity-chart.js`, fund tab)

- Rebuilds the curve from `fund-checkins.json` daily pnl; **last point anchored to
  `holdings.json.total_assets_usd`** (日频回放，非实时 — live quotes live in the cards above)
- SVG viewBox tracks the container's real pixel size via ResizeObserver — do **not**
  reintroduce `preserveAspectRatio="none"` (it stretched the x-axis date labels)

### Fear & Greed / VIX (`src/vix-gauge.js`)

- Title: **恐慌贪婪指数** (EN: Fear & Greed · VIX)
- Flashy half-donut: green→gold→red gradient, glowing needle, spring overshoot
- Data: **live** — `GET /api/vix` (serverless `api/vix.js`) fetches CBOE's public
  delayed-quote CDN on each request (5-min edge cache, no key needed); falls back
  to static `public/data/vix.json` (from local `vix_log.csv`) if the API fails
- The readout sits **directly under the needle hub** in the tall bottom strip of
  the SVG canvas (`VIEW_H = 272`, readout absolute bottom-center of `.vix-gauge-visual`)
- Zones conceptually 0–15 / 15–25 / 25–40

### US 10Y Treasury yield card (`src/yield10-card.js`, homepage next to VIX)

- Data: **intraday first** — `GET /api/yield10` (serverless `api/yield10.js`)
  fetches CBOE's public TNX index (10Y yield × 10, delayed ~15 min; same free CDN
  as /api/vix) for the ticking value, and FRED's public `DGS10` CSV for the daily
  series (sparkline + 52w range + previous-close reference for the change).
  Fallbacks: FRED → Treasury.gov daily CSV → static `public/data/yield10.json`
- Chg calc: CBOE `price_change` when usable, else live tick − last FRED daily
  close before the trade date. Card shows a pulsing **LIVE** badge + `HH:MM ET`
  when intraday, `日频` badge when it degraded to the daily close
- Edge cache 2 min (intraday). Card: big readout + `▲/▼ chg（chg_pct%）较上日收盘`
  + 90-obs sparkline (blue gradient, hi/lo labels) + `近90日 lo–hi%` range

### Heatmap (`src/landing.js` + checkin UI)

- Data: `public/data/fund-checkins.json`
- Built from local Mac folder:  
  `~/Downloads/CryptoTrix/portfolio-daily-tweet/Portfolio_Daily_YYYYMMDD.md`  
  by parsing lines like `当日盈亏：+$95` / `−$647`
- ~38 trading days so far (~2026-07-28 → 2026-09-19); empty cells for rest of 2026
- Hover/tap popover shows date, Day N, pnl
- **Click → that day's X post.** Each series entry may carry `"tweet": "<status-url>"`;
  when present the cell opens that exact post. When absent (default today — X API
  was down on 2026-09-21 so exact IDs couldn't be backfilled), the click opens an
  X search scoped `from:CryptoTrix1 "财富自由基金每日持仓速览" since:<date> until:<date+1>`. To upgrade to
  direct links: fetch tweet IDs (mcp x-post `get_user_tweets`, match
  `[每日持仓速览] · Day N | MM-DD`), add `"tweet"` per date, redeploy.

### Check-in series rule (for Claude Code / any daily routine) — READ BEFORE TOUCHING `fund-checkins.json`

**Never append a `series` row for a day with no NEW US-market settlement** (US weekends/holidays, and the Sun/Mon-before-open 发稿 days). One row = one new US close.

- `date` = 发稿 day (Beijing). Tue–Sat posts cover Mon–Fri US closes; a Saturday row is legit (Friday close). **Sunday and Monday rows are never legit** unless the US market actually traded and the post covers a new close.
- A `Portfolio_Daily_*.md` that only repeats the last close (header says `周末休市` / `沿用` / `无新成交`, or `价格截止` is the same date as the previous report, e.g. 9/27 & 9/28 both "as of 9/25") **still gets posted to X, but gets NO series row** — otherwise the old pnl is copied and double-counted in the 净值走势 curve (pnl is summed to rebuild equity) and in the heatmap / "N 个交易日打卡" count.
- Check before committing: (1) the new row's `pnl` ≠ previous row's `pnl` unless genuinely coincident; (2) the report's `价格截止` date is later than the previous row's; (3) `date` weekday is Tue–Sat; (4) `scripts/sync-checkins.mjs --dry-run` prints no `+` line for carry-forward days (it now skips them and logs `~ … skipped`).
- `day` is a calendar counter (today − 2026-07-16 + 1), so it legitimately jumps over skipped days (73 → 76). Do not renumber or fill the gap.
- Root cause history: 2026-09-29 commit `0ad143c` hand-added 9/27 (Day 74) and 9/28 (Day 75) rows copied from 9/26 (−193) because the daily routine ran on the weekend and the memory rule "每次日报同步当日盈亏进 fund-checkins.json" was applied mechanically. Removed 2026-10-02. The same rule should be added to `~/.claude/skills/portfolio-daily-tweet/SKILL.md` / the `cryptotrix-site-sync-in-daily-flow` memory.

## Canonical data files

```
public/data/holdings.json     # equities + options + cash + annual targets (fund/portfolio/options/landing)
public/data/holdings.csv      # editable positions (from my-portfolio.csv)
public/data/options.csv       # CSP rows (from my-options.csv)
public/data/cn-fund.json      # A-share / RMB allocation (万元)
public/data/fund-checkins.json
public/data/vix.json
public/data/yield10.json
public/vol_data.json
```

Regen holdings after editing CSVs:

```bash
# default CASH_MODE=weight when weights present
npm run regen-holdings
# then set annualized_return_pct / targets in holdings.json if needed
```

**Holdings source of truth on user’s Mac:**  
`/Users/garyadella/Downloads/CryptoTrix/my-portfolio.csv` (+ `my-options.csv`)

**A股基金 snapshot (万元 RMB):**  
债券 46.27, 黄金 3.88, 红利低波 22.16, 标普500 5.6, 纳指100 9.85, 中证A500 7.73, 沪深300 5.08, 恒生科技 5.38, 科创和创业板 1.21 → total **107.16 万**

## Brand tokens

- bg `#0B0D10` · panel `#12151B` · accent `#F0B90B` · up `#0ECB81` · down `#F6465D`
- Font: Inter + system CJK
- Always keep #NFA #DYOR; X: https://x.com/CryptoTrix1

## Prices

- Client: `src/lib/prices.js` — live `/api/prices` → else snapshot from holdings → else demo
- **Live is wired (2026-09-21)**: `api/prices.js` fetches Finnhub `/quote` when
  `FINNHUB_TOKEN` is set in Vercel env (Production, encrypted; token injected via
  `vercel env add` from the owner's local key file — never committed). Edge cache
  60s; hv30/weekly refs still come from the snapshot merge. No token or upstream
  failure → snapshot fallback (`__source: 'snapshot'`)
- Badge on fund page: holdings source + price source (live shows 实时行情)

## What was already decided / don’t reopen unless asked

1. Public remake in **new** repo + Vercel project; leave old `crypto-trix.vercel.app` alone  
2. Holdings from **repo JSON**, periodically updated from local CSV  
3. Cash **broker-anchored** (baseline 32,038 + trade adjustments); weight reverse-inference retired 2026-09-22  
4. Annual ring uses **11.04% / 20%**, not total-return ~50%  
5. Options are their **own tab**, not only embedded in fund page  
6. Homepage: heatmap on top; journey + fear/greed **same row** below  
7. Fear/greed **number** directly **under the needle hub** (bottom-center of the gauge), not whole card above heatmap  
8. Journey: **center = 3 colored progress numbers**; **right = legend intro** (both)

## Suggested next tasks (if user continues)

- Sync latest `my-portfolio.csv` / check-ins / vix_log from Mac → `public/data/*` → redeploy  
- Wire real `/api/prices` with env token  
- Polish journey center typography (3 numbers can feel cramped)  
- Merge `feat/public-site` → `main` when ready  
- Optional: connect GitHub repo to Vercel for push-to-deploy  

- **Latest article card (homepage):** edit `public/data/latest-article.json` (`url`, `title`, `date`, `platform`, optional `excerpt`; strip `?s=` tracking) — rendered by `renderLatestArticle()` in `src/landing.js`; also update the static fallback in `index.html` `#latest-article` if you want no-JS parity.

## Key source files

| Area | Files |
|------|--------|
| Nav | `src/nav.js`, `src/styles/shared.css` |
| Landing | `index.html`, `src/landing.js`, `src/styles/landing.css` |
| Journey rings | `src/journey-rings.js` |
| VIX gauge | `src/vix-gauge.js` |
| Fund board | `src/fund.js`, `fund.html` |
| Options | `src/options.js`, `options.html` |
| CN fund | `src/cn-fund.js`, `cn-fund.html` |
| Holdings load | `src/lib/holdings.js`, `scripts/regen-holdings.mjs` |
| Prices | `src/lib/prices.js`, `api/prices.js` |

## Local owner paths (Mac)

- Project dump / old site: `~/Downloads/CryptoTrix/`
- Daily notes: `~/Downloads/CryptoTrix/portfolio-daily-tweet/`
- VIX log: `~/Downloads/CryptoTrix/portfolio-daily-tweet/vix_log.csv`

## Language

User prefers **zh-Hans**. Product UI is zh-first (portfolio page EN). Speak Chinese unless they write English.

## 2026-09-27 · Share meta, favicon, timeline fallback fix

- **Share meta (all 6 entry pages):** each `<head>` now has favicon links, `canonical`, Chinese `description`, Open Graph (`og:image` = absolute `https://crypto-trix-public.vercel.app/og-image.png`, 1200×630, `zh_CN`) and Twitter `summary_large_image` tags (`@CryptoTrix1`). Titles/descriptions are page-specific — if you add a new page, copy the block and add it to `vite.config.js` inputs.
- **Assets in `public/`:** `favicon.svg` (gold/white "CT" mark on `#0B0D10`), `favicon-32.png`, `favicon.ico` (16/32/48, PNG-embedded), `apple-touch-icon.png` (180), `og-image.png` (wordmark + "$137K → $2M · 持仓、盈亏与决策，全程公开" + @CryptoTrix1 + domain; no fast-changing numbers, so no daily regen needed). Source HTML/SVG templates were rendered with headless Chrome on the agent box.
- **Bug fix `src/landing.js`:** `renderTimeline()` failure path called undefined `patchCurrentTimeline()`. It is now implemented: when `/data/timeline.json` fails, it refreshes an existing `#tl-current-headline/#tl-current-body/#tl-asof` from holdings (same `formatCurrentHeadline/Body` as success path), or — since `index.html` `#timeline-list` is empty — renders a minimal built-in `FALLBACK_TIMELINE_ENTRIES` (origin + live "当前" entry). Keep that constant roughly in sync with `public/data/timeline.json` if the origin wording changes.

- 2026-09-30: Synced 6 X long-form articles into `public/data/articles.json` (newest first; AMD 2026-09-28 is newest); `latest-article.json` + `index.html` fallback now point at the AMD article; `src/articles.js` now sorts by date desc within published/coming groups.
- 2026-10-02: fund.html now has a 仓位分布 Allocation donut (new `src/allocation-chart.js`, styles in `fund.css`) between the equity chart and holdings table: top 6 holdings + 其他 (8 small) + 现金 slice, values from the same `mvOf()`/`cash_usd` as the page total; hover/tap swaps the center to slice name/%/$, legend shows % per slice.
- 2026-10-02: Redesigned 净值走势 chart (`src/equity-chart.js` + equity block in `fund.css`): monotone-cubic gold line on real points (no resample), gradient area, dashed grid + $K y-axis, glowing end dot + latest value label, crosshair + tooltip card (date / NAV / 当日 Δ / 较区间起点 Δ, from checkin `pnl`), left→right clip draw-in. Range pills are now 一周/一月/全部 (old 一年 was identical to 全部 with ~49 pts). Same data source (`fund-checkins.json` anchored to holdings total).
- 2026-10-02: Removed filler rows 9/27 (Day 74) and 9/28 (Day 75) from `fund-checkins.json` (copied −193 from 9/26; no new US settlement) and made `scripts/sync-checkins.mjs` skip carry-forward reports (same `价格截止` date as an earlier report, or 类型/备注 says 周末休市·/沿用/无新成交). See "Check-in series rule". Note: launchd `sync-site.sh` has been failing with "Operation not permitted" (macOS privacy on ~/Downloads) so that job is not what wrote these rows.
- 2026-10-02: 净值走势 range pills are now 一周/一月/三个月/一年/全部 (user request; with ~47 pts 三个月/一年/全部 currently show the same data — expected). Pills are `flex:1` on mobile so all five fit one row.
- 2026-10-02: Top nav redesigned (`src/nav.js` + nav block in `shared.css`): glass bar + gold hairline, segmented tab track with a gold pill that glides from the previous page's tab (sessionStorage `ct-nav-prev`), inline-SVG icons (hidden <900px), brand mark, mono ghost "ARTICLE" button (no emoji). Mobile: row 1 brand+Article, row 2 horizontally scrollable tabs with edge fades and the active tab auto-centered (nav height 173→93px). Tabs are now a `<nav>` with `aria-current="page"`; same hrefs/active logic.
- 2026-10-02: A股基金 持仓明细 table replaced by the shared donut (`renderAllocation()` in `src/allocation-chart.js`, now option-driven: title/center/format/maxNamed; donut CSS moved fund.css → shared.css). 9 funds shown individually (¥ center, 万 in legend, category as sub-label); old table had no P&L column, only 名称/类别/金额/占比/权重条, all preserved in legend/hover. Dead `.cat-chip`/`.row-bar-*` CSS removed.
- 2026-10-02: Fixed 财富自由进度 legend text being ellipsised on desktop (journey card is only ~461px wide in the 2-col dash-row, legend column ~125px): `.jr-leg-item` is now a grid (● label / value stacked, label wraps) and switches back to the one-line row via `@container (min-width: 270px)` on `.jr-side`; ring column flexes (`minmax(150px,1fr)` legend). Wording/numbers untouched.
- 2026-10-02: Journey-ring legend back to one line per item (no wrap/stack): labels shortened to 「2M进度」 / 「年化目标20%」 (现金占比 unchanged) in `src/journey-rings.js`; legend column keeps >=190px (`minmax(190px,1fr)`), font tightens to 11.5px via container query if narrower.
- 2026-10-02: Merged 美股仪表盘 (portfolio.html) into 财富自由基金: removed the page/tab/entry, `vercel.json` 301s `/portfolio(.html)` → `/fund.html`; fund.html gained WTD/MTD/YTD stat cards (MV-weighted, ex-cash; 8 cards in 4×2) and 本周/本月/今年/较成本 columns in the single holdings table (the old 浮盈 note text dropped as duplicate). Dropped the Holdings-by-Weight treemap (donut + weight badges cover it) and the landing CTA/timeline chip for the old page.
- 2026-10-02: Fixed console error "<rect> attribute width: negative" — rAF timestamp can precede `performance.now()` captured at animation start; clamp progress ≥0 in equity-chart.js / allocation-chart.js.
- 2026-10-02: **Returns now deposit-aware** (old MV-weighted price-based WTD/MTD/YTD was wrong). Inputs in `public/data/capital.json` (`start_of_year_usd: 105323`, `deposits_total_usd: 26600`, optional `deposits:[{date,amount_usd}]`) — **Claude Code: update capital.json whenever the user makes a new deposit** (add to deposits_total_usd and append a dated entry so WTD/MTD can subtract it). Logic in `src/lib/capital.js`: YTD profit = total assets − start_of_year − deposits_total; YTD % = profit ÷ (start_of_year + deposits_total) (=131,923 now). WTD/MTD = Σ daily `pnl` from `fund-checkins.json` over the period (row's market-close date = previous weekday of its 发稿日; week = Mon–Fri of latest close, month = calendar month) ÷ period-start value (≈ total − Σpnl − deposits dated in period). fund.html cards 本周盈亏/本月盈亏/今年盈亏 show $ and %; table columns renamed 周涨跌/月涨跌/年涨跌 (个股价格涨跌, not account return). Homepage ring 「年化目标20%」 and the timeline "current" headline ("今年 +X%") use the same YTD % via `holdings.ytd` (`loadHoldingsData` fetches capital.json). **Removed `annualized_return_pct`** from holdings.json / loader / timeline fallback — do not reintroduce. Known open item: holdings.json `invested_usd` (93,975, "无出入金") still drives fund.html 累计盈亏/收益率 and conflicts with capital.json (105,323 + 26,600); needs the user's decision.
- 2026-10-02: Correction: 2026 total deposits are **$26,600** (not 16,600) → `capital.json` `deposits_total_usd: 26600`; YTD basis is now 105,323 + 26,600 = **131,923** (YTD = total − 131,923; % = profit ÷ 131,923). Nothing else hardcodes these numbers (grep'd 16600/121923). `invested_usd` and the 累计盈亏/收益率 cards intentionally untouched pending the user's decision.
- 2026-10-02: fund.html cards 累计盈亏/收益率 → **持仓累计盈亏 / 持仓收益率**: Σ(market value − costTotal) over current stock positions, no cash; % = pnl ÷ Σ costTotal (computed in `positionsPnl()` in `src/lib/holdings.js` → `cum_pnl_usd`/`cum_cost_usd`/`cum_return_pct`; fund.js uses live prices, homepage timeline headline uses the same helper on the snapshot). Removed `invested_usd` (93,975) and `cum_pnl_usd` from holdings.json, the loader, and `scripts/regen-holdings.mjs` (don't reintroduce). Result is +$46,795 / +72.16% on cost $64,852 — NOT the 137.76% the user expected; per-stock `costTotal` values look odd (AMD cost −$490, PLTR $3.59/sh, META $80/sh) so cost basis in holdings.json needs the user's confirmation. YTD card sub-line simplified to 「扣除入金，相对年初收益（含期权）」.
- 2026-10-02: Homepage **总资产 card** (`#net-worth`, top of hero-wrap, `src/net-worth.js` + `.nw-*` CSS in landing.css): headline total USD (≈ ¥ below), two-segment bar + chips 美股 $ (holdings.json `total_assets_usd`) / A股基金 ¥ (cn-fund.json `total_wan`×10000), % split, note line (汇率 / 美股 as_of / A股 as_of). FX = `capital.json` `fx_usdcny` (6.7146, `fx_as_of` 2026-10-02, source open.er-api.com; ECB 6.7045 on 10/1 as cross-check) — **update fx_usdcny + fx_as_of occasionally** (no live FX API is called). Each source fails independently (shows the other with a note); count-up animation respects prefers-reduced-motion. A股 figure is a 9/21 snapshot — refresh cn-fund.json when it changes.
- 2026-10-03: **WTD/MTD now include the live session** (`computePeriod()` in `src/lib/capital.js`): pnl = Σ check-in pnl in the period (by market-close date) + live, where live = live total assets − holdings.json `total_assets_usd` (the last synced close) − deposits dated after that close. Live is only added when a *new* US session exists (NY date is a weekday later than the latest check-in close) → weekends/holidays add 0, and a session already in fund-checkins.json is never double-counted. Requires holdings.json `as_of` == latest check-in close date (row date − previous weekday); if they are out of step, or `/api/prices` is down, it falls back to check-ins only (sub-line says 「仅打卡数据」). Start value = snapshot total − completed pnl − deposits in [period start, latest close]; % = pnl ÷ start. New week/month on a Monday/1st starts from the snapshot total automatically. **Keep holdings.json total/as_of and the daily check-in row updated together.** The page does not poll prices; reload for fresh numbers.
- 2026-10-03: **保存为图片 (snapshot) tool.** `src/lib/snapshot.js` exports `attachSnapshotButton(elOrSelector, name)` (idempotent; a MutationObserver re-adds the button if the card's innerHTML is re-rendered) and `snapshotElement()`. Camera button top-right of the card (`.snap-btn`, CSS at the end of shared.css: low opacity, gold on hover, title 「保存为图片」, hidden in print, `.has-snap` adds right padding to `.panel-head/.checkin-head/.eq-head` so it never covers header content). `html-to-image` (new dependency) is lazy-loaded on first click (separate ~14KB chunk); renders at pixelRatio 2 on #0B0D10, then composes padding + footer strip (favicon logo, 「CryptoTrix」 — deliberately no domain/vercel.app text —, capture time Asia/Shanghai, 「@CryptoTrix1 · #NFA」) on a canvas; downloads `cryptotrix-<name>-YYYYMMDD.png` and shows a 「已保存」 toast. Google-Fonts Inter (cross-origin CSS) is inlined manually (latin subset) because html-to-image can't read it; CJK uses the system font stack. Before capturing it adds `html.snap-capturing` (kills CSS animation/transition), waits until ≥2.6s after page load for rAF chart/ring animations, and sets `[data-final]` text (net-worth count-up). **To add a new card:** `attachSnapshotButton('#my-card', 'my-card')` in that page's JS. Covered: home 总资产/journey rings/恐慌贪婪/打卡热力格/公开历程; fund stat cards/NAV chart/仓位分布/持仓; cn-fund overview cards/类别 panel/donut; options stat cards/合约明细.
- 2026-10-03: Snapshot footer no longer shows the domain; also removed the vercel.app address (and the retired 美股仪表盘 tab) from the 2026-09 timeline.json body so the 公开历程 snapshot doesn't show it either.
- 2026-10-03: fund.html 仓位分布 donut now shows every stock as its own slice (14 + 现金, no 其他): fund.js passes `{maxNamed: Infinity, twoColFrom: 9}` to renderAllocation; palette extended to 16 hues (first 9 unchanged so cn-fund is untouched), tiny slices get a ≥1.6° visible arc, legend is 2 columns on desktop (≥9 rows) and a single list on mobile.
- 2026-10-03: **公开历程 is now an auto-generated 周总结 / 月总结 feed (data only, fixed templates, no commentary).**
  - **Claude Code daily-flow rule (add to the portfolio daily routine): after updating `public/data/holdings.json` (its `as_of` MUST be the US market-close date of the numbers — a weekday, never the 发稿日) and/or `cn-fund.json` / `fund-checkins.json`, run `cd ~/Downloads/CryptoTrix/crypto-trix-public && npm run summaries`, then commit `public/data/summaries.json public/data/snapshots/` with the data commit.** It is idempotent (re-running changes nothing; prints `SUMMARIES_CHANGED` or `SUMMARIES_UP_TO_DATE`; add `-- --dry-run` to preview). `scripts/sync-site.sh` (launchd) also runs it after the check-in sync and commits those paths.
  - Generator `scripts/generate-summaries.mjs` (no network): writes today's snapshot `public/data/snapshots/<close-date>-us.json` (+ `-cn.json` from cn-fund.json `as_of`), then builds `public/data/summaries.json` (newest first). **Weekly:** the ISO week (Mon–Fri closes, id `2026-W40`) of the latest snapshot is rebuilt on every run (`partial:true` until Friday's close is in); older complete weeks are created once and then frozen. **Monthly:** `2026-09`-style entry is created/overwritten when the latest snapshot IS the month's last US trading day (weekends + basic NYSE holiday list handled), and also created once for any finished month without an entry that has a snapshot on its last trading day. Weeks need an opening snapshot (previous close ≤4 days earlier); months fall back to a derived start (`start_derived`, = end − check-in pnl − dated deposits).
  - Numbers: US pnl = Σ `fund-checkins.json` pnl whose market-close date (row date − previous weekday) falls in the period; pct = pnl ÷ opening total; top gainers/losers = price effect on opening holdings (opening shares × Δprice; ignores trades/cash, so they don't sum to pnl); position changes = share-count diff between opening/closing snapshots (|Δ|<0.1 ignored); A股 = latest `cn-fund.json` snapshot (+ change vs a previous distinct snapshot when one exists — so keep updating cn-fund.json `as_of`); `combined.total_usd_end` uses `capital.json` `fx_usdcny`; YTD only on the entry that ends at the latest data. `unreconciled_usd` = (end − start − pnl − dated deposits) when ≥$50 (e.g. W40 +$590: the 9/29 broker re-anchor) — shown as a fixed-template note. Fields that can't be computed are omitted, never invented.
  - History: `scripts/backfill-snapshots.mjs` (one-time, already run) rebuilt snapshots 2026-09-18 … 2026-10-02 from git history of holdings.json (commit map verified against the check-in chain). Nothing exists before 9/18, so only W39 (9/21–9/25), W40 (9/28–10/2) and Sept 2026 (derived start, no position data) were generated; July/Aug have no snapshots.
  - Frontend: `src/summary-feed.js` (replaces the old `renderTimeline` + timeline CSS in landing.js/landing.css); `#summary-feed` in index.html. Month cards are gold/larger; weeks of a finished month collapse under it (「展开 N 个周总结」); latest 4 standalone weeks + 3 months, rest under 「查看更多」; 「起点」 footer shows the milestones from `timeline.json` (stale "current" entry removed). Every summary card has the 保存为图片 button.
- **全球资产 tab (`/assets.html`, 2026-10-03)**: 全球资产市值排名（黄金/白银/加密 Top8/28 家公司/美债/M2/全球股债房大类/13 个代币化 RWA）。数据由 `npm run assets`（`scripts/generate-assets.mjs`，免 key）生成 `public/data/assets.json`，每项带 `kind`(live/derived/static)、`source`、`data_date`，页面只读 json。实时源：CoinGecko（加密+RWA）、companiesmarketcap.com CSV（公司市值，美元）、Yahoo Finance v8 chart（金银价、涨跌、1 年走势；**必须用短 UA `Mozilla/5.0`，长浏览器 UA 会 429**）、US Treasury FiscalData（美债）、FRED M2SL。静态约值写在脚本顶部 `STATIC`（WGC 黄金存量 220,700t、Silver Institute 白银 193 亿盎司(2023)、SIFMA 2026 全球股市 $157.8T/债券 $160.7T、Savills 全球房地产 $393.3T(2025 年初)）——页面标「约」，每年需人工核对更新。金银市值 = 地上存量 × 实时期货价，标「估」。某源失败时沿用上次 json 同 id 条目并标 stale；条目 <25 不覆盖。**需定期手动跑**：`cd ~/Downloads/CryptoTrix/crypto-trix-public && npm run assets && git add public/data/assets.json && git commit && git push && vercel deploy --prod --yes`（未接入 sync-site.sh）。前端：`assets.html` + `src/assets.js` + `src/styles/assets.css`，导航 tab「全球资产」在 `src/nav.js`（A股基金之后、Article 之前）；类别 pills、可排序表头、搜索、万亿/亿 ⇄ T/B 切换、点击行展开来源与日期、表格卡片带 保存为图片。
  - 注意：2026-10-03 在 Mac 上跑 `npm run assets` 时 Yahoo 返回 403、CoinGecko 连接失败（Mac 当前网络被拦），当天 assets.json 是在 box（Linux）上生成后拷回的；若 Mac 网络恢复可直接跑，否则在 box 跑 `node scripts/generate-assets.mjs` 再 CopyFromBox。
  - 全球资产筛选规则（用户要求）：类别 pill（股票/债券与现金类/房地产…）只列个体资产；总量类参考 `type:'class'`（仅 全球股市/全球债券/全球房地产 三项）只在「全部」里出现。美国国债、美元 M2 算个体资产（债券与现金类）。「房地产」类别个体资产 = 全球市值最大的 8 家上市地产/REIT（Welltower、Prologis、Equinix、Simon、American Tower、Digital Realty、Public Storage、Realty Income；`REITS` 常量，来自 companiesmarketcap CSV）。

- **13F 追踪 tab（13f.html，2026-10）**：数据来自 SEC EDGAR，由 `scripts/generate-13f.mjs` 生成 → `public/data/13f/<id>.json` + `index.json`（17 家机构，每家最近 6 个季度，含与上季对比）。运行：`npm run 13f`（全部，约 2 分钟，限速 ≤8 req/s）或 `npm run 13f -- berkshire pershing`（子集）。User-Agent 默认 `CryptoTrix <占位邮箱>`，可用环境变量 `SEC_CONTACT_EMAIL` 或 `SEC_USER_AGENT` 覆盖。**需能访问 sec.gov 的机器**（Mac 没测过；上次在 box 上跑完再 CopyFromBox 拷回 Mac 仓库）。13F 在季度结束后 45 天内申报，建议在 **2/5/8/11 月中旬（约 15 日后）手动跑一次**，再 build + 部署。机构名单/中文名/掌门人/CIK 在脚本顶部 `INSTITUTIONS`，CUSIP→ticker 覆盖表在 `CUSIP_OVERRIDES`（其余用 SEC company_tickers.json 尽力映射，映射不到显示英文名；SpaceX 等未上市显示「(未上市)」）。注意：①Duquesne 的 value 以千美元申报，脚本按隐含股价自动 ×1000；②Pershing Square 2026 年起改用 Pershing Square Inc.（CIK 2026053）申报，`also_ciks` 已合并；③期权行(putCall)单列、不计入持仓市值；④13F-HR/A：RESTATEMENT 覆盖、NEW HOLDINGS 追加。页面底部已标注 13F 局限（滞后约45天、仅美股多头、不含空头/债券/现金/非美股，桥水等只见一部分）。

- **13F 头像（2026-10）**：`public/img/13f/<id>.webp`（256px，单张 ≤7KB，来源 ~/.claude/skills/13f-holdings-card/assets/*_headshot.png，AI 人像，用户已确认使用）；`scripts/generate-13f.mjs` 的 INSTITUTIONS 每家有 `avatar` 字段，文件存在才写入数据（否则 null → 页面回退首字母徽章）。pills 和机构头部用 `<img class="av-img">` + CSS 圆形裁切，截图（html-to-image）可正常内联。换头像：覆盖对应 webp 即可。
- 2026-10-05 股息收入：fund.html 新增「股息收入」卡片（src/dividends.js，数据 public/data/dividends.json），首页总资产卡下单行提示。`npm run dividends` 按 holdings.json + 现金中 SGOV 255 股（常量，非持仓）用 Yahoo 过去 12 个月派息重算；Mac 连不上 Yahoo，需在能访问的机器上跑后拷回。持仓变动后重跑。
