# v79 — จัดไฟล์เป็นโฟลเดอร์ + เอกสารเข้า repo ครบ

คำขอ: "เอาให้ up to date ทั้งหมด พร้อมจัดไฟล์ให้เข้า folder — หน้าหลักไฟล์เริ่มเยอะ หาไม่เจอ"
ไม่มีการเปลี่ยนการคำนวณหรือหน้าจอ — ย้ายที่อยู่ไฟล์อย่างเดียว (bump build เพื่อให้ PWA ที่ติดตั้งไว้โหลด cache ชุดใหม่)

## โครงใหม่

| ก่อน (root) | หลัง |
|---|---|
| `shared.js` · `i18n.js` · `vault.js` · `autobot.js` · `liveport.js` | `js/` |
| `market-data.json` · `signal-history.json` · `fundamentals.json` · `bot-paper.json` · `notifications.enc.json` · `notify-state.json` | `data/` |
| `scripts/test_*` (26 ไฟล์ปนกับสคริปต์ pipeline) | `tests/` |
| `PROGRESS-*.md` | `docs/progress/` |
| `claude/release-v*.md` | `docs/releases/` |

root เหลือ `index.html` · `manifest.json` · `service-worker.js` (ต้องอยู่ root: หน้าแรกของ GitHub Pages · scope ของ service worker = โฟลเดอร์ที่ไฟล์อยู่) · `README.md` · `CLAUDE.md` · `.gitignore`

## path ที่แก้ตาม
- `index.html`: `<script src="js/…">` · `fetch('data/notifications.enc.json')` · `EXPECTED_SHARED_BUILD = 'v79'`
- `js/shared.js`: `fetch('data/market-data.json' | 'data/fundamentals.json' | 'data/bot-paper.json')` · `APP_BUILD = 'v79'`
- `service-worker.js`: `SHELL_FILES` → `/js/…` · `CACHE_NAME = 'finance-os-v79'`
- `scripts/*.py`: ค่าเริ่มต้นของ `MARKET_DATA_OUT` · `SIGNAL_HISTORY_OUT` · `FUNDAMENTALS_OUT` · `BOT_PAPER_OUT` · `NOTIFY_STATE` · `NOTIFY_FILE` → `data/…` (workflow รันจาก root เหมือนเดิม)
- `.github/workflows/market-data.yml` · `line-notify.yml`: `git add` · `git show HEAD:` · `jq` · ขั้น Show summary → `data/…` (แก้เฉพาะบรรทัดที่เป็นคำสั่ง คอมเมนต์ประวัติเดิมไม่แตะ)
- `cloudflare-worker/autobot/worker.js`: `import '../../js/autobot.js'` · `'../../js/liveport.js'` · `wrangler.toml` `MARKET_URL` → `…/data/market-data.json` · README ของ Worker
- `tests/`: path ค่าเริ่มต้น `js/…` · เทสต์ Python เพิ่ม `scripts/` เข้า `sys.path` เอง (เดิมใช้โฟลเดอร์ของตัวเอง)
- `CLAUDE.md` · `README.md`: ตารางโครงสร้าง + คำสั่งรันเทสต์ใหม่ (`node tests/test_shared.cjs js/shared.js`)
- `.gitignore`: `__pycache__/` · `*.pyc` · `.DS_Store`

## เอกสารที่เข้า repo รอบนี้
- `CLAUDE.md` · `docs/progress/PROGRESS-2026-10-21.md` · `PROGRESS-2026-10-23.md` · `docs/releases/release-v73.md` – `release-v78.md` (จาก local ของผู้ใช้)
- `docs/releases/release-v62.md` – `release-v70.md` (จาก branch เก่า `claude/admiring-keller-4fkn10` ที่ไม่เคยเข้า `main`)
- ยังไม่มีในที่ใดเลย: `release-v71.md` · `release-v72.md` · `PROGRESS-2026-10-20.md`

## ตรวจแล้ว
- เทสต์ JS 16 ชุด + Python 10 ชุดผ่านทั้งหมดจาก root ด้วย path ใหม่ (รวม `test_token.py` หลังติดตั้ง `google-auth`)
- Chromium เสิร์ฟ repo ที่ `/personaltracker-dashboard/` แบบเดียวกับ GitHub Pages: `js/*` และ `data/*` ตอบ 200 ทั้งหมด · `SHARED_BUILD = v79` ตรงกับ index.html · service worker pre-cache `/js/…` ครบใน `finance-os-v79` · ไม่มี 404
- ยังไม่ได้รัน workflow จริงบน GitHub Actions ด้วย path ใหม่ — รอบแรกหลัง merge ให้ดู log ของ "Update market data" ว่า commit ไฟล์ใน `data/`

## หลัง merge
- PWA ที่ติดตั้งไว้: ปิด-เปิดแอปหนึ่งครั้งให้ service worker v79 ติดตั้ง (index.html เป็น network-first จึงโหลด `js/` ใหม่ได้ทันทีอยู่แล้ว)
- Worker (ถ้า deploy แล้ว): แก้ `MARKET_URL` ให้ลงท้าย `/data/market-data.json` แล้ว `npx wrangler deploy` ใหม่
- เครื่อง local (`~/Desktop/personaltracker-dashboard`): ใช้ `git clone` ของ repo แทนโฟลเดอร์คัดลอก จะได้ไม่ต้องอัปโหลดไฟล์เองอีก

---

## รอบ 2 (2026-10-26) — Worker ขึ้น Cloudflare จริง · Binance ตอบ 403

ผู้ใช้ deploy Worker แล้ว (`workers.dev` · ใส่ `workers_dev = true` / `preview_urls = false` ใน `wrangler.toml` เอง) · แอปเชื่อม Worker ได้ ·
ตั้ง `BINANCE_KEY`/`BINANCE_SECRET` แล้วหน้าพอร์ตสดขึ้น **"Binance: Binance HTTP 403"**

- 403 ที่ไม่มี `code` ไม่ใช่คำตอบของระบบ API Binance (key ผิด/ถูกจำกัด IP จะได้ JSON `-2015` ซึ่งแปลเป็นข้อความอยู่แล้ว) แต่เป็นด่านหน้า (CloudFront/WAF) ที่ตัดก่อน —
  `bnb()` เดิมทิ้งเนื้อหาคำตอบ จึงบอกไม่ได้ว่าโดนบล็อกเพราะอะไร
- แก้ใน `cloudflare-worker/autobot/worker.js`:
  - ส่ง `user-agent: FinanceTracker-Worker/1.0 (read-only)` ทุกคำขอที่ไป `api.binance.com` — `fetch` ใน Worker ไม่ใส่ให้เอง และกฎ WAF ทั่วไปบล็อกคำขอที่ไม่มี User-Agent ด้วย 403
  - คำตอบที่ไม่มี `code` → ข้อความ "ถูกด่านหน้าของ Binance บล็อกก่อนถึงระบบ API (ไม่ใช่ปัญหา key)" + header `server`/`x-cache` + ข้อความในหน้า (ตัด HTML · ≤ 160 ตัว)
- เทสต์ `tests/test_autobot_worker.mjs` +3 ข้อ (ส่ง User-Agent · 403 HTML จาก CloudFront จำลอง · error ที่มี code ยังแปลเหมือนเดิม) — 2 ข้อแรกตกกับโค้ดเดิม
- ยังไม่รู้สาเหตุจริงจนกว่าจะ deploy ตัวนี้แล้วดูข้อความใหม่ — ถ้ายัง 403: ข้อความจะบอกว่าด่านไหน (CloudFront ตามประเทศ / WAF) แล้วค่อยเลือกทางแก้ (เช่น endpoint สำรอง `api1`–`api4`/`api-gcp.binance.com`)
- ไม่แตะแอป (`index.html` / `js/*`) → ไม่ bump `APP_BUILD`

## รอบ 3 (2026-10-26) — MetaMask: RPC HTTP 429

ใส่ที่อยู่กระเป๋าแล้วหน้าพอร์ตสดขึ้น **"MetaMask Ethereum: RPC HTTP 429"** — RPC ฟรีของ publicnode ถูกแชร์กับ Worker อื่นบน IP ของ Cloudflare จึงโดนจำกัดความถี่
(และรอบนั้น Binance ยังขึ้น "HTTP 403" แบบเดิม เพราะรอบ 2 ยังไม่ได้ merge/deploy)

- `js/liveport.js` `CHAINS[*].rpcs`: ทุกเครือข่ายมี RPC สาธารณะ 3–4 ตัว (publicnode ก่อน · ตามด้วย RPC ทางการของเครือข่าย / drpc.org / 1rpc.io / llamarpc) · `evmRequests` ส่ง `rpcs` ต่อ
- `worker.js` `rpc(urls, body)`: ลองทีละตัว — HTTP ไม่ ok / ตอบไม่ใช่ array (batch) / เน็ตล้ม → ตัวถัดไป · ล้มทุกตัว → error เดียวบอกผลของทุกตัว · ใช้ทั้งตอนดึงยอดและตอนอ่านชื่อ/ทศนิยมของเหรียญที่เพิ่ม · ส่ง User-Agent เดียวกับ Binance
- subrequest แย่สุด 6 เครือข่าย × 4 = 24 + Binance ~5 — ยังต่ำกว่า 50 ของ Worker ฟรี
- เทสต์: `test_autobot_worker.mjs` +2 (publicnode 429 → ใช้ drpc · ล้มทุกตัว → ข้อความรวม) · `test_liveport.cjs` +2 — ตกกับโค้ดเดิม
- **RPC สำรองยังไม่ได้ทดสอบกับของจริง** (session นี้ต่อออกไปหา RPC ไม่ได้) — ตัวที่ใช้ไม่ได้จะถูกข้ามไปเองและขึ้นชื่อในข้อความ error
- `liveport.js` เปลี่ยนแค่ข้อมูลที่ Worker ใช้ (แอปอ่านแค่ `CHAINS[*].name`) → ไม่ bump `APP_BUILD`

ยังค้าง: ผู้ใช้มีเหรียญ **BBTC** ใน MetaMask — ต้องเพิ่มด้วยที่อยู่สัญญา และ Binance ไม่มีคู่ `BBTCUSDT` → ยังไม่มีราคา (รอผู้ใช้บอกเครือข่าย/ที่อยู่สัญญา และตัดสินใจว่าจะให้คิดราคาตาม BTC หรือไม่)
