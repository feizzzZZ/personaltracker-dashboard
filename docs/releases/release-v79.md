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
