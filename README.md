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
- 🎯 Financial Goals Tracker
- 📄 Monthly Report PDF Export
- 🔔 Budget Notification

---

## 🔒 Security (personal-use setup)
- **AI calls**: direct from browser; API key stored in localStorage on this device only. OK for single-user, non-public use. ⚠️ If you ever host this publicly, switch to the proxy in `cloudflare-worker/` first (kept in repo, ready to deploy).
- **Google OAuth token**: memory-only, never persisted. Legacy stored tokens auto-purged.
- **No credentials in source**: `clientId` / `spreadsheetId` entered once via ⚙ settings modal, stored on your device.
