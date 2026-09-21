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
- Pages: `index.html`, `fund.html`, `options.html`, `portfolio.html`, `cn-fund.html`
- Entry scripts under `src/*.js`; shared styles in `src/styles/`
- Serverless: `api/prices.js` — **must be ESM `export default`** (CJS `module.exports` breaks on Vercel with type:module)

## Site map / nav order

Top nav (`src/nav.js`):

1. 首页 `/`
2. 财富自由基金 `/fund.html`
3. 期权 `/options.html`
4. 美股仪表盘 `/portfolio.html`
5. A股基金 `/cn-fund.html`

## Homepage layout (current, important)

Under site nav, inside `.hero-wrap`:

1. **打卡热力格** `#fund-checkin` — full-year 2026 GitHub-style P&L heatmap  
2. **`.dash-row`** (CSS grid, 2 cols desktop / 1 col mobile):
   - Left: **财富自由 · 旅程进度** concentric Activity rings `#journey-rings`
   - Right: **恐慌贪婪指数** VIX gauge `#vix-gauge`
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

- `annualized_return_pct`: **11.04** (user-stated; not cum_pnl/invested)
- `annual_return_target_pct`: **20** (2026 target)
- Cash: **reverse from weights** — `total = holdings_mv / (weight_sum/100); cash = total - holdings_mv` (~$34,188). Not the old $32,038 broker baseline.

### Fear & Greed / VIX (`src/vix-gauge.js`)

- Title: **恐慌贪婪指数** (EN: Fear & Greed · VIX)
- Flashy half-donut: green→gold→red gradient, glowing needle, spring overshoot
- Data: **live** — `GET /api/vix` (serverless `api/vix.js`) fetches CBOE's public
  delayed-quote CDN on each request (5-min edge cache, no key needed); falls back
  to static `public/data/vix.json` (from local `vix_log.csv`) if the API fails
- The readout sits **directly under the needle hub** in the tall bottom strip of
  the SVG canvas (`VIEW_H = 272`, readout absolute bottom-center of `.vix-gauge-visual`)
- Zones conceptually 0–15 / 15–25 / 25–40

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

## Canonical data files

```
public/data/holdings.json     # equities + options + cash + annual targets (fund/portfolio/options/landing)
public/data/holdings.csv      # editable positions (from my-portfolio.csv)
public/data/options.csv       # CSP rows (from my-options.csv)
public/data/cn-fund.json      # A-share / RMB allocation (万元)
public/data/fund-checkins.json
public/data/vix.json
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
3. Cash from **weight reverse-inference**, not fixed 32038  
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

## Key source files

| Area | Files |
|------|--------|
| Nav | `src/nav.js`, `src/styles/shared.css` |
| Landing | `index.html`, `src/landing.js`, `src/styles/landing.css` |
| Journey rings | `src/journey-rings.js` |
| VIX gauge | `src/vix-gauge.js` |
| Fund board | `src/fund.js`, `fund.html` |
| Options | `src/options.js`, `options.html` |
| Portfolio EN | `src/portfolio.js`, `portfolio.html` |
| CN fund | `src/cn-fund.js`, `cn-fund.html` |
| Holdings load | `src/lib/holdings.js`, `scripts/regen-holdings.mjs` |
| Prices | `src/lib/prices.js`, `api/prices.js` |

## Local owner paths (Mac)

- Project dump / old site: `~/Downloads/CryptoTrix/`
- Daily notes: `~/Downloads/CryptoTrix/portfolio-daily-tweet/`
- VIX log: `~/Downloads/CryptoTrix/portfolio-daily-tweet/vix_log.csv`

## Language

User prefers **zh-Hans**. Product UI is zh-first (portfolio page EN). Speak Chinese unless they write English.
