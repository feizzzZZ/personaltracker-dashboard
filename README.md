# Personal Finance Dashboard

Personal finance tracker and investment dashboard built with HTML/JS.

## Features
- 📊 Cash Flow (Monthly & Yearly)
- 🏦 Accounts & Bank Balances
- 💼 Investment Holdings (Asset_Tracker based)
- 🛡 Insurance Dashboard
- 💰 Budget Alert with Sidebar Badge
- ⚔️ Benchmark Comparison — XIRR พอร์ตจริง vs S&P 500 (จำลอง cashflow เดิม รวมผล FX)
  อยู่ในหน้า Holdings การ์ด "คุณ vs ตลาด" · ราคาย้อนหลังจาก GitHub Actions pipeline
- 💧 Wealth Engine — savings rate / invest rate / เงินที่เก็บได้แต่ยังไม่ลงทุน
- 💵 Dividend Income — passive income + FIRE progress
- 💳 **Debt Tracker (v40)** — แยกหนี้ออกจากเงินสด, ดอกเบี้ยต่อเดือน,
  แผนปลดหนี้ avalanche/snowball, เปรียบเทียบ "จ่ายหนี้ vs ลงทุน"
- 🎯 Financial Goals Tracker
- 📄 Monthly Report PDF Export
- 🔔 Budget Notification
- 🗂 **Documents (v71)** — คลังใบยื่นภาษี / สลิปเงินเดือน / บิลบัตรเครดิต / ใบยืนยันซื้อขายหุ้น
  ไฟล์จริงอยู่ใน Google Drive · แท็บ `Documents` ในชีตเก็บรายละเอียด + ลิงก์ (ดู `docs/releases/`)

---

## 📁 โครงสร้างไฟล์ (v79)

| ที่อยู่ | มีอะไร |
|---|---|
| `index.html` · `manifest.json` · `service-worker.js` | ตัวแอป — ต้องอยู่ root (หน้าแรกของ GitHub Pages · PWA · scope ของ service worker) |
| `js/` | `shared.js` (data layer) · `i18n.js` · `vault.js` · `autobot.js` · `liveport.js` |
| `data/` | JSON ที่ GitHub Actions เขียนให้ — `market-data` · `signal-history` · `fundamentals` · `bot-paper` · `notifications.enc` · `notify-state` (ไม่ต้องแก้เอง) |
| `scripts/` | สคริปต์ Python ของ pipeline (ดึงราคา · สัญญาณ · งบบริษัท · บอทจำลอง · แจ้งเตือน) |
| `tests/` | เทสต์ทั้งหมด (`.cjs` · `.mjs` · `.py`) — รันจาก root เช่น `node tests/test_shared.cjs js/shared.js` |
| `cloudflare-worker/autobot/` | Worker ของบอทเทรด + พอร์ตสด |
| `docs/releases/` | บันทึกแต่ละเวอร์ชัน `release-vNN.md` |
| `docs/progress/` | บันทึกความคืบหน้า `PROGRESS-YYYY-MM-DD.md` |
| `icon/` · `splash/` | รูปไอคอนและหน้าจอเปิดแอป |
| `CLAUDE.md` | คู่มือ repo สำหรับ Claude Code |

---

## 🔒 Security (personal-use setup)
- **AI calls**: direct from browser; API key stored in localStorage on this device only. OK for single-user, non-public use. ⚠️ If you ever host this publicly, switch to the proxy in `cloudflare-worker/` first (kept in repo, ready to deploy).
- **Google OAuth token**: memory-only, never persisted. Legacy stored tokens auto-purged.
- **No credentials in source**: `clientId` / `spreadsheetId` entered once via ⚙ settings modal, stored on your device.


---

## 🔄 Market data pipeline (v40)

`.github/workflows/market-data.yml` → `scripts/fetch_market_data.py` → `data/market-data.json`
รัน 06:30 และ 18:30 เวลาไทย · stdlib ล้วน ไม่ต้อง pip install ไม่ต้องใช้ API key

ดึง ~30 keys จาก FRED + Yahoo:
- **Macro**: Fed rate, CPI/Core CPI, PCE/Core PCE, unemployment, NFP, GDP,
  US2Y/10Y, real 10Y (TIPS), yield curve 2s10s, credit spread (HY OAS), VIX
- **ราคา**: S&P 500, Nasdaq, SET, USD/THB, ทอง (XAU + GLD), WTI, DXY, BTC, ETH
- **เทคนิค**: RSI(14) + MA200 ของ S&P / SET / Nasdaq
- **Sectors**: ETF 10 กลุ่ม พร้อม relative strength เทียบ SPY → หน้า Sectors
- **History**: S&P 500 + USD/THB รายสัปดาห์ 5 ปี → benchmark XIRR

**Fail-safe**: ไฟล์เดิมถูก merge เสมอ — API ตัวไหนล่ม key นั้นคงค่าเดิมไว้ ไม่หายจากไฟล์
(ทดสอบแล้วด้วยการตัดเน็ต 100% → ข้อมูลเดิมอยู่ครบ)

**`fetched_at` vs `updated`**: FRED ส่ง observation date (CPI = ต้นเดือน) ไม่ใช่เวลาที่ดึง
`js/shared.js` จึงใช้ `fetched_at` ตัดสินว่าข้อมูลไหนสดกว่าตอน merge กับชีต
ส่วน `updated` ใช้แค่แสดงผลว่า "ข้อมูลนี้เป็นของวันไหน"
