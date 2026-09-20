# CryptoTrix Public

**$137K → $2M · 持仓、盈亏与决策，全程公开**

Public visitor site for [CryptoTrix](https://x.com/CryptoTrix1) — Wealth Freedom Fund dashboard + US Equities map.  
CryptoTrix 公开访客站点：财富自由基金实时看板 + 美股持仓仪表盘。

> ⚠️ **Not financial advice · #NFA #DYOR**  
> This is a public showcase with **demo/sample data by default**. Not a private admin tool. No brokerage credentials.

Live concept reference: https://crypto-trix.vercel.app/

---

## What’s included / 包含页面

| Page | Path | Lang |
|------|------|------|
| Landing / 首页 | `/` | zh-first |
| 财富自由基金 · 实时看板 | `/fund.html` | zh |
| US Equities Dashboard | `/portfolio.html` | en |

**Brand:** CryptoTrix · accent gold `#F0B90B` on dark `#0B0D10` · panels `#12151B` · up `#0ECB81` · down `#F6465D`

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
```

Requires Node 18+.

---

## Deploy on Vercel / 部署

1. Import `garychian/crypto-trix-public` in Vercel.
2. Framework preset: **Vite** (build `npm run build`, output `dist`).
3. The `/api/prices` serverless stub ships demo quotes (see `api/prices.js`).
4. Optional env (only if you wire a live provider later):
   - `FINNHUB_TOKEN` or `TIINGO_TOKEN` — **never commit secrets**
   - `VITE_PRICES_URL=/api/prices`
   - `VITE_DEMO_ONLY=1` — force client-side demo

`vercel.json` is included for headers + API rewrite.

---

## Demo → live data / 从示例切到实盘

By default the client (`src/lib/prices.js`) tries `/api/prices`. If that fails (local static host, no serverless), it falls back to built-in demo quotes from `src/data/demo.js`.

**Response shape** (same as the original site):

```json
{
  "TSLA": {
    "price": 341.6,
    "changePct": 1.82,
    "hv30": 59.94,
    "weeklyRef": 328.4,
    "monthlyRef": 315.2,
    "yearlyRef": 248.5
  }
}
```

### How to plug in live prices

1. Implement a real quotes provider inside `api/prices.js` (Finnhub / Tiingo / etc.) using **Vercel environment variables only**.
2. Or point `VITE_PRICES_URL` at your own endpoint that returns the shape above.
3. Replace demo holdings in `src/data/demo.js` (`DEMO_HOLDINGS`, `DEMO_OPTIONS`, `PORTFOLIO_HOLDINGS`) with a public JSON feed if you publish real positions.
4. Refresh `public/vol_data.json` periodically for IV/HV columns on the fund board.

No brokerage login, cookies, or private keys belong in this repo.

---

## Stack

- Vite + vanilla HTML / JS / CSS (multi-page)
- Client-side mock + optional Vercel `/api/prices`
- Mobile-friendly dark fintech UI

---

## Links

- X: [@CryptoTrix1](https://x.com/CryptoTrix1)
- Repo: https://github.com/garychian/crypto-trix-public

---

MIT · Built for public transparency, not financial advice.
