# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user personal finance PWA ("Finance OS"): cash flow, bank accounts, investment holdings, insurance, budget, debt tracker, dividends/FIRE, financial goals, market signals, a paper-trading bot, and a read-only live crypto portfolio (Binance + MetaMask). No build step, no npm, no framework — plain HTML/CSS/JS loaded directly by the browser, plus a GitHub Actions pipeline that fetches market data and sends notifications. The deployed origin is a GitHub Pages site at `/personaltracker-dashboard/` (see `manifest.json` `start_url`/`scope`).

**Note on working directory**: `~/Desktop/personaltracker-dashboard` is often a plain folder copy, *not* a git checkout (see `docs/progress/PROGRESS-*.md` for the latest state). Check `git status` before assuming git operations will work — changes may need to be copied into the real repo checkout and committed there.

## Repo layout (v79)

```
index.html  manifest.json  service-worker.js   ← must stay at the root (GitHub Pages entry, PWA manifest, SW scope = its folder)
js/            shared.js · i18n.js · vault.js · autobot.js · liveport.js
data/          JSON written by GitHub Actions: market-data · signal-history · fundamentals · bot-paper · notifications.enc · notify-state
scripts/       pipeline Python (fetch_*.py, bot_paper.py, line_notify.py, notify_store.py, probe_sources.py, make_icons/splash.py)
tests/         all test_*.cjs / .mjs / .py — run from the repo root
cloudflare-worker/autobot/   Worker (imports ../../js/autobot.js + liveport.js)
docs/releases/ release-vNN.md · docs/progress/ PROGRESS-YYYY-MM-DD.md
icon/ splash/  PWA images
```

When adding a file, put it in the matching folder — don't add new files at the root. Moving a file means updating every path that names it: `index.html` `<script src>`, `service-worker.js` `SHELL_FILES`, fetches in `js/shared.js`, workflow `git add` lines, script `*_OUT` defaults, `wrangler.toml` `MARKET_URL`, and test default paths.

## Architecture

### Frontend: one big HTML file + small shared JS modules
- `index.html` (~13.6k lines) — entire UI: markup, CSS, and all page-render functions (`renderOverview`, `renderBudget`, `renderDebt`, etc.), inlined and loaded as plain `<script>` tags (no modules/bundler).
- `js/shared.js` — the **data layer**, loaded before `index.html`'s inline scripts. Pure-ish functions for: loading/merging market data, classifying holdings (cost basis, P/L), rebalancing, dividends, debt, goals, notifications encoding, regime/signal computation. `window.SHARED_BUILD` exposes `APP_BUILD` (bumped per release, currently `v82`) so `index.html` can assert the two files are in sync.
- `js/vault.js` (v74) — local username/password lock: PBKDF2-SHA256 (600k) → AES-GCM key; encrypts the data cache + Google token in localStorage (`finOS_enc:*`). No server — the "account" is per-device. Login/lock UI + auto-lock + ⌘K palette live in the `v74 — เข้าสู่ระบบ` block of `index.html`.
- `js/autobot.js` (v75) — rule-based trading bot engine (pure: evaluate rules → paper fills), shared by the app's "บอทเทรด" tab and the Cloudflare Worker in `cloudflare-worker/autobot/` (cron every 15 min, KV state, Bearer token). Phase 1 is paper only — see `docs/releases/release-v75.md`.
- `js/liveport.js` (v78) — live portfolio math (pure): merge Binance/MetaMask balances, running WACC from Binance `myTrades`, the two-cost-basis view (sheet `waccMap` THB vs Binance trade history USD), EVM JSON-RPC encode/decode. Shared by the app's "พอร์ตสด" page (`renderLive`) and the same Cloudflare Worker (`/live/*` endpoints). Read-only by design: the Worker refuses a Binance key that has trade/withdraw permission (`apiRestrictions`), and there is no order endpoint. Live prices come from Binance's public WebSocket in the browser, not the Worker. See `docs/releases/release-v78.md`.
- `js/i18n.js` — Thai→English `translate()` dictionary; most UI strings go through a `_L(thai, english)` helper inline in `index.html` rather than a key-based i18n system.
- Routing is a flat registry, not a router: `pageRenderFns` in `index.html` maps page ids (`overview`, `cashflow`, `budget`, `debt`, `signals`, `watch`, `bot`, `autobot`, `live`, `docs`, ...) to render functions; sidebar groups/tabs come from `NAV_GROUPS`. `switchPage()` renders a page only the **first** time it's shown (`renderedPages`), so a page that holds live resources (WebSocket, timers) needs its own enter/leave hook called from `switchPage` — see `liveOnPage(active)`.
- `service-worker.js` — PWA offline/caching logic. `CACHE_NAME` (`finance-os-vNN`) must be bumped together with `APP_BUILD`, or installed PWAs keep serving the old `shared.js`.

### Portfolio menu (v81 — user decisions 2026-10-29)
- Invest tabs: ภาพรวมพอร์ต · พอร์ตสด · บอทเทรด · รายการซื้อขาย (Transactions) · ปันผล · ต้นทุน & ค่าเงิน · ปรับสมดุล. Dividends is a tab here (page id `dividends` unchanged), not its own sidebar group.
- The user removed the pages ผลตอบแทนจริง (`performance`), ขายแล้ว (`realized`) and ไม่มีใครดูแล (`dormant`) — don't add them back without asking. Their data stays: `finOS_valueLog` is still written by `logValueSnapshot` from `renderPortfolio` (Analyst TWR, net-worth history), `realized` feeds the Holdings Realized P&L card, `CLS` (iaRefresh) still feeds the Costs & FX page (`renderCost`).
- Holdings: the top "True cost" card became IRR (`irrSummary` + `perfQuote`: whole portfolio incl. sold + dividends, sub-line = current holdings; < 1 year shows the cumulative return, not annualized). The table's True cost column was kept on purpose.
- Transactions (`renderAtTxTable`): dates `YYYY-MM-DD`, type dropdown built from the sheet's actual `Transaction_Type` values (`investTxTypes`), search (`filterInvestTx`), Fee column = `commTHB`.

### Dividends page (v82 — being reworked toward the user's Snowball screenshots, one item at a time)
- Yield / Payout card (`renderDvYield` + `dividendYieldView`): two borderless dropdowns — Yield (%) / Annual Payout (THB) × Holdings / Categories (`group`) / Sectors (Asset_Tracker `Industry`; fundamentals.json has no sector). Annual payout per holding = `dividendCalendar().byTicker` forecast (same set as the forward-income card), falling back to dividends received in the last 12 months; Yield = ÷ today's value, Yield on cost tick = ÷ cost; groups divide by the whole group's value incl. non-payers.
- `_dvCal()` computes the dividend calendar once per render and is shared by `renderDividendTracker` and the chart. The other Snowball sections (diversification donut, annual growth, future payments, dividends received, dividend growth) are not built yet — wait for the user to ask.

### Debt menu (v77)
- Sidebar group `debts`: pages `debts` (overview), `debtsched` (contract schedule), `debt` (the older credit-card/interest page — id kept for existing links). "บัญชี & หนี้" is now just "บัญชี".
- The user explicitly removed an avalanche/snowball payoff simulator in v58 — `debtsched` is a factual schedule, don't add strategy simulations back without asking.
- Card monthly obligation = minimum payment (`getDebtCfg().minPct/minFloor`), not the typical payment (mostly everyday spending paid in full).
- User decision (2026-10-25): debts from the `Debts` tab that have no account column (e.g. the motorcycle installment) are **not** added to the liabilities used by Overview / net worth / FIRE (`splitBalances` stays account-column based). They only appear in the debt menu — don't wire `debtOverview` totals into net worth without asking.

### Live portfolio (v78 — page `live` "พอร์ตสด" in the `invest` group)
- User decisions (2026-10-25): sources are **Binance + MetaMask** only. Thai stocks wait until the user names their broker (Settrade Open API is the candidate; Dime/Streaming have no API). Show **both cost bases side by side** — sheet (`waccMap`, THB/unit, all platforms) and Binance trade history (`myTrades` WACC, USD/unit) — with a toggle for which drives the headline P&L; don't merge them into one number.
- Read-only by design: no Deposit/Trade buttons, no order/withdraw endpoints. The Binance key lives only in Worker secrets `BINANCE_KEY`/`BINANCE_SECRET` ("Enable Reading" only). `keyIsReadOnly()` checks `/sapi/v1/account/apiRestrictions` (cached 1 h in KV `liveKeyCheck`) and refuses keys with trade/withdraw/margin/futures/transfer rights. Workers have no static egress IP, so keys can't be IP-restricted — another reason they must stay read-only (this also affects the bot's phase-2 plan).
- Data flow: Worker `GET /live/holdings` returns Binance spot/funding/Simple Earn plus MetaMask balances (batched JSON-RPC to publicnode, one request per chain; wallet config in KV `liveCfg` via `GET/PUT /live/config`). Prices do **not** go through the Worker: the browser opens Binance's public WebSocket (`data-stream.binance.vision`, `@miniTicker`) and reads klines/`ticker/price` from `data-api.binance.vision`. Ticks patch numbers by element id (`_lvPaint`, at most 1/s) instead of re-rendering; balances re-poll every 60 s only while the page is visible.
- Binance cost: `POST /live/costs` pulls `myTrades` for every held asset × USDT/FDUSD/USDC, at most 35 calls per request (free Workers allow 50 subrequests) — the app loops with a `since` round marker. Trades are stored compactly in KV `liveTrades` and resumed from `lastId`; pairs that return `-1121` are marked `none`. WACC merges all pairs in time order. Convert / Auto-Invest / deposits / Earn rewards aren't in `myTrades` → shown as "history covers x%", never guessed. Fees paid in BNB are not added to cost (shown separately). The Binance-basis summary excludes stablecoins.
- Pricing (v80): prices come from Binance `<ASSET>USDT` pairs via `LivePort.pricePair()`; `PRICE_AS` maps a coin with no pair to the asset backing it 1:1 — currently only `BBTC → BTC` (user decision 2026-10-29). Add entries only when the user asks; never map by symbol automatically (spam tokens reuse names). Price/spark state in `index.html` is keyed by `LivePort.priceAsset()`, not the held symbol.
- Binance from the Worker (v79): `api.binance.com`'s CloudFront blocks Cloudflare Worker IPs (403 "Request blocked"); `binHost()` probes `api-gcp`/`api1-4` and caches the first that answers (KV `liveBinHost`, 6 h). MetaMask RPC falls back through `CHAINS[*].rpcs` on 429/5xx.
- Gotchas: call Binance only from the fetch handler, never from cron (Binance geo-blocks with HTTP 451 and cron runs in arbitrary colos). `data-api.binance.vision` error responses (400) carry no CORS header, so the browser can't tell "no such pair" from a network failure — detect missing pairs from the full `ticker/price` list.

### Where settings live (v76 — don't re-add duplicates)
- Theme: topbar moon button only (`cycleTheme()`, cycles Light → Dark → Auto); mobile sidebar has its own.
- ⚙ topbar menu (`#set-menu`): language · notification settings · Export PDF / Backup / Restore.
- Google Sheets config (`gsOpenModal`), password, lock, sign-out: avatar menu → "บัญชีและความปลอดภัย" (`acctOpen()` / `#acct-modal`). The login screen keeps its own Sheets link.
- Notification setup (keys / push / test): modal `#nt-set-modal` via `ntOpenSetup()`; `_ntSetup()` renders into it and `renderNotify()` re-renders it while `_nt.setup` is true. The notify page itself is list-only.

### CSS gotchas
- `index.html` CSS is layered by version: the v74 "Midday" theme block (~line 1500+) restates base rules **outside media queries**, so it can silently override earlier mobile rules (this wiped the v66 safe-area padding on `.grp-tabs`). Put mobile overrides in the v74 block's own `@media(max-width:768px)` section.
- Mobile (≤768px, iPhone `black-translucent` status bar): sticky-top elements use `top: env(safe-area-inset-top)`, not `top:0`; `#app::before` paints a solid backing behind the status bar. Desktop/landscape (>768px) uses the sticky `.topbar` instead.
- Horizontal scrollers (`.grp-tabs`) need `overflow-y:hidden` — if content is even 1px taller, iOS lets them rubber-band vertically.
- `#tx-fab` (z-index 900, inline `display:block` from JS) is hidden while any `.gs-modal-overlay.show` is open — new modals should reuse that class.

### Data source: Google Sheets, not a database
There is no backend database. The user's spreadsheet (via `spreadsheetId`) is the source of truth for transactions, holdings, budgets, etc. The browser authenticates directly with Google OAuth (`google.accounts.oauth2`; the access token is persisted to localStorage — encrypted via `vault.js` when the user has set a password, plaintext otherwise) using a `clientId` the user enters once in the settings modal (`GS_CONFIG`, stored in `localStorage` on-device). All spreadsheet reads/writes go through the Sheets REST API called directly from the browser — see `GS_CONFIG` / `_docsApi` style helpers in `index.html`.

Key tabs: `Transaction` (wide format: header row ~25, one column per bank/card account — a row's `acct` map holds per-column movements; card payoffs are `Debt` rows with bank −x and card +x), `Reconcile` (actual balances), `Asset_Tracker`, and app-created optional tabs `Documents` (v71) and `Debts` (v77: one row per debt — installment/term/due day/limit; progress is computed from `Transaction` rows where Transactions=`Debt` and Type=`Pay Category`, never stored). Optional tabs are header-matched (`parseDocumentRows` / `parseDebtRows`), created on first save (`docsEnsureSheet` / `debtsEnsureSheet`), and edits go through `sheetRowGuard` before overwriting a row.

### Data pipeline: GitHub Actions + stdlib-only Python
Three workflows in `.github/workflows/`, each with extensive inline comments explaining hard-won lessons (timeouts, rebase-before-push races, FRED IP-blocking on GH Actions, etc.) — **read the comments before changing these**, they encode prior incident fixes:
- `market-data.yml` — runs twice daily (06:30/18:30 Thai time) and on manual dispatch. Pipeline: `fetch_market_data.py` (prices/macro/sectors, Yahoo-only — FRED dropped, blocked on GH Actions IPs) → `fetch_signals.py` (technical/risk signals, must run after market data) → `fetch_fundamentals.py` (company fundamentals, weekly refresh) → `bot_paper.py` (simulated paper-trading portfolio, no network, no real trades). Writes/merges into `data/market-data.json`, `data/signal-history.json`, `data/fundamentals.json`, `data/bot-paper.json` (paths are the scripts' `*_OUT` env-var defaults; the workflow runs from the repo root). Always merges with prior data so a failed fetch never blanks a key; commits with `continue-on-error` per step but fails the job overall if any step degraded.
- `line-notify.yml` — separate from the data pipeline on purpose (different scheduling needs). Reads already-committed `data/market-data.json`. Sends to in-app notifications (`data/notifications.enc.json`, encrypted with `NOTIFY_KEY`), Web Push (VAPID), and optionally LINE (toggle via repo variable `NOTIFY_LINE`). Modes: `daily` (08:00), `alert` (20:00, price anomalies), `weekly` (Mon 08:30), `monthly` (1st of month).
- `probe-sources.yml` — manual-only, one-off diagnostic to check whether a data source is reachable from GitHub Actions IPs (vs. blocked). Never commits, never touches the other files.

### Security model (intentional, single-user)
- AI API keys and Google `clientId`/`spreadsheetId`: localStorage only, entered once via the settings modal, never committed.
- `data/notify-state.json` / `data/notifications.enc.json`: encrypted at rest with secret `NOTIFY_KEY` (plaintext portfolio values were previously committed in the clear — fixed in v72).
- If ever hosted publicly (not single-user), the README calls out `cloudflare-worker/` as the proxy to switch to instead of calling AI APIs directly from the browser.
- Cloudflare Worker (`cloudflare-worker/autobot/`, deployed by the user on 2026-10-26 to `workers.dev`; redeploy with `npx wrangler deploy` from that folder after pulling — GitHub edits don't reach Cloudflare by themselves): every endpoint needs `Authorization: Bearer <BOT_TOKEN>` (constant-time compare, CORS limited to `ALLOWED_ORIGIN`). Once `BINANCE_KEY` is set, `BOT_TOKEN` grants **read access to real balances** — the app stores it vault-encrypted when a password is set. MetaMask uses public addresses only; never ask for or store a seed phrase/private key.

## Running tests

No test runner/CI config wires these together — run them individually **from the repo root**. All live in `tests/` and print `✓`/`✗` per check; a non-zero exit / nonzero fail count means something broke.

JS tests (plain Node, no framework — they `eval()` the real `shared.js`/`i18n.js` source into a faked `window`/`localStorage`, so they exercise the actual browser code):
```
node tests/test_shared.cjs js/shared.js
node tests/test_budget.cjs js/shared.js
node tests/test_calc_v68.cjs js/shared.js
node tests/test_dividends.cjs js/shared.js
node tests/test_rebalance.cjs js/shared.js
node tests/test_regime.cjs js/shared.js
node tests/test_guard.cjs js/shared.js
node tests/test_docs.cjs js/shared.js
node tests/test_debts.cjs js/shared.js    # v77 — Debts tab parsing, installment counting (real motorcycle rows), cards, schedule
node tests/test_i18n.cjs js/i18n.js
node tests/test_vault.cjs js/vault.js
node tests/test_perf.cjs js/shared.js
node tests/test_autobot.cjs js/autobot.js
node tests/test_autobot_worker.mjs     # Worker handler with fake KV/fetch (incl. v78 /live/* with fake Binance + RPC)
node tests/test_liveport.cjs js/liveport.js   # v78 — live portfolio: balances merge, trade-history WACC, two cost bases, EVM decode
node tests/test_invest_tx.cjs js/shared.js   # v81 — Transactions types/search + Holdings IRR card
node tests/test_notify.cjs js/shared.js   # optionally [enc-file] [NOTIFY_KEY] to cross-check Python↔WebCrypto decryption
```

Python tests (stdlib + `unittest.mock`, no network — run directly, no pytest wiring assumed; they add `scripts/` to `sys.path` themselves):
```
python3 tests/test_signals.py
python3 tests/test_signals_carry.py
python3 tests/test_signals_e2e.py
python3 tests/test_fundamentals.py
python3 tests/test_bot_paper.py
python3 tests/test_line_notify.py
python3 tests/test_monthly_report.py
python3 tests/test_notify_store.py
python3 tests/test_state_enc.py   # needs `cryptography`, Python 3.10+
python3 tests/test_token.py      # needs `google-auth`
```

There is no browser/UI test harness checked into the repo; manual UI verification (headless-Chrome screenshot script + mock sheet data, and since v78 a mock Worker that runs the real `worker.js` in Node with fake Binance responses and real RPC) has been built ad hoc in session scratchpads — see the latest `docs/progress/PROGRESS-*.md` for paths and whether they still exist. Headless Chrome `--window-size` below ~500px does not give a real phone layout; use the in-app browser's mobile preset (375px) for mobile checks. When re-testing locally, unregister the service worker and clear `caches` first or you'll get stale files. Chrome can't emulate the iPhone notch: to check safe-area layout, replace `env(safe-area-inset-top…)` in the page's `<style>` tags with e.g. `59px` via JS. Check both portrait (≤768px chip-tab layout) and phone landscape (~932×430, desktop layout).

## Conventions when editing

- **Version bump**: `APP_BUILD` in `js/shared.js` (e.g. `'v73'`) should be bumped on every behavior-changing release; `index.html` checks `SHARED_BUILD` against its own expected build to catch stale-file mismatches. Write a `docs/releases/release-vNN.md` describing what changed (this repo's existing pattern — see `docs/releases/release-v7*.md`; follow-up fixes before deploy go in a "รอบ 2" section of the same note rather than a new version) and update the current `docs/progress/PROGRESS-YYYY-MM-DD.md` (or start a new dated one).
- **Bilingual UI**: new user-facing strings need both Thai and English via the inline `_L(thai, english)` pattern (or `js/i18n.js`'s `translate()` dictionary) — don't add Thai-only strings.
- **Data correctness over code elegance**: this is a financial app; the test suites above were written specifically to catch "plausible but wrong" numeric bugs (e.g. cost-basis after partial sells, stale price caching, budget totals excluding card-swipe spend). When touching `js/shared.js` calculation functions, run the matching `test_*.cjs`/`test_*.py` before considering the change done.
- **Pipeline files are append/merge, not overwrite**: `fetch_market_data.py` and friends always merge new data into the existing JSON rather than replacing it, so a partial/failed fetch degrades gracefully instead of blanking data. Preserve this merge behavior in any pipeline script changes.
- **No real trading (yet)**: `bot_paper.py` and the v75 autobot (`autobot.js` + Worker) are simulation only, and the v78 live portfolio is read-only — the only exchange secret allowed is a read-only Binance key, and there are no order endpoints (`test_autobot_worker.mjs` asserts this). Real-money execution is a separate, explicitly-approved phase 2 (trade-only keys as Worker secrets, server-enforced limits, kill switch; note Workers can't be IP-restricted); don't add order-placing code without that.
