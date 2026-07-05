# Personal Finance Dashboard

Personal finance tracker and investment dashboard built with vanilla HTML/JS.

## Features
- 📊 Cash Flow (Monthly & Yearly)
- 🏦 Accounts & Bank Balances
- 💼 Investment Holdings (Asset_Tracker based)
- 🛡 Insurance Dashboard
- 💰 Budget Alert with Sidebar Badge
- 📈 Benchmark Comparison (SET, S&P 500, Gold, Crypto)
- 🎯 Financial Goals Tracker
- 📄 Monthly Report PDF Export
- 🔔 Budget Notification

---

## 🔒 Security (personal-use setup)
- **AI calls**: direct from browser; API key stored in localStorage on this device only. OK for single-user, non-public use. ⚠️ If you ever host this publicly, switch to the proxy in `cloudflare-worker/` first (kept in repo, ready to deploy).
- **Google OAuth token**: memory-only, never persisted. Legacy stored tokens auto-purged.
- **No credentials in source**: `clientId` / `spreadsheetId` entered once via ⚙ settings modal, stored on your device.
