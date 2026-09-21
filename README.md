# CryptoTrix Public

**$137K → $2M · 持仓、盈亏与决策，全程公开**

Public visitor site for [CryptoTrix](https://x.com/CryptoTrix1) — Wealth Freedom Fund dashboard + US Equities map.  
CryptoTrix 公开访客站点：财富自由基金实时看板 + 美股持仓仪表盘。

> ⚠️ **Not financial advice · #NFA #DYOR**  
> This is a public showcase. Not a private admin tool. No brokerage credentials.

Live: https://crypto-trix-public.vercel.app/

---

## What’s included / 包含页面

| Page | Path | Lang |
|------|------|------|
| Landing / 首页 | `/` | zh-first |
| 财富自由基金 · 实时看板 | `/fund.html` | zh |
| US Equities Dashboard | `/portfolio.html` | en |

**Brand:** CryptoTrix · accent gold `#F0B90B` on dark `#0B0D10` · panels `#12151B` · up `#0ECB81` · down `#F6465D`

---

## Data source / 数据来源

The site loads holdings at runtime from:

```
public/data/holdings.json   ← canonical (fetched by fund / portfolio / landing)
public/data/holdings.csv    ← editable copy of equity positions
public/data/options.csv     ← editable copy of CSP options
public/vol_data.json        ← IV/HV overlay for the fund board
```

Prices still come from `/api/prices` (with demo fallback in `src/data/demo.js`).  
Holdings list / cash / day / goal come from `holdings.json` — demo.js is only used if that fetch fails.

**现金按权重反推：** when CSV rows include `Weight`, `regen-holdings.mjs` sets `cash_usd` / `total_assets_usd` / `cum_pnl_usd` from `total = holdings_mv / (weight_sum/100)` (not a fixed broker cash baseline). The fund board reads `cash_usd` from `holdings.json`.

Current snapshot: **as_of 2026-09-20 · Day 67 · cash ≈ $34,188**（现金按权重反推；非旧 broker $32,038）。

---

## 更新持仓 / Update holdings

Whenever positions change, update the repo data and redeploy:

### Option A — edit JSON directly (fastest)

1. Edit `public/data/holdings.json`:
   - `as_of`, `day`, `cash_usd`, `invested_usd`, `goal_usd`
   - `holdings[]`: `{ ticker, shares, cost, weight? }`
   - `options[]`: `{ symbol, type, strike, expiry, premium }`
2. Optionally mirror the same rows into `public/data/holdings.csv` / `options.csv`.
3. Commit, push, and Vercel will redeploy (or run `vercel deploy --prod`).

### Option B — edit CSVs then regenerate

1. Overwrite `public/data/holdings.csv` and/or `public/data/options.csv`.
2. Regenerate JSON (keeps meta fields from the existing JSON unless overridden):

```bash
# default: 现金按权重反推 (CASH_MODE=weight when holdings have Weight)
#   total = holdings_mv / (weight_sum/100); cash = total - holdings_mv
AS_OF=2026-09-20 DAY=67 INVESTED_USD=93975 \
  node scripts/regen-holdings.mjs

# force a fixed cash instead of weight reverse-inference:
# CASH_MODE=env CASH_USD=32038 node scripts/regen-holdings.mjs
```

3. Commit + push / redeploy.

### After deploy

- Fund board: https://crypto-trix-public.vercel.app/fund.html  
- Raw data: https://crypto-trix-public.vercel.app/data/holdings.json  

Refresh `public/vol_data.json` separately when you want updated IV/HV columns.

No brokerage login, cookies, or private keys belong in this repo.

---

## Local run / 本地运行

```bash
npm install
npm run dev
```

Open http://localhost:5173/

```bash
npm run build    # → dist/
npm run preview  # preview production build
npm run regen-holdings  # CSV → public/data/holdings.json
```

Requires Node 18+.

---

## Deploy on Vercel / 部署

1. Project: `crypto-trix-public` (linked to this repo).
2. Framework preset: **Vite** (build `npm run build`, output `dist`).
3. `/api/prices` serverless stub ships demo quotes (see `api/prices.js`); wire Finnhub/Tiingo via env when ready.
4. Optional env (never commit secrets):
   - `FINNHUB_TOKEN` or `TIINGO_TOKEN`
   - `VITE_PRICES_URL=/api/prices`
   - `VITE_DEMO_ONLY=1` — force client-side demo prices

`vercel.json` is included for headers + API rewrite.

```bash
~/.local/bin/vercel deploy --prod --yes
```

---

## Stack

- Vite + vanilla HTML / JS / CSS (multi-page)
- Runtime holdings from `public/data/holdings.json`
- Client-side price mock + optional Vercel `/api/prices`
- Mobile-friendly dark fintech UI

---

## Links

- X: [@CryptoTrix1](https://x.com/CryptoTrix1)
- Repo: https://github.com/garychian/crypto-trix-public
- Live: https://crypto-trix-public.vercel.app/

---

MIT · Built for public transparency, not financial advice.
