# FinanceTracker AutoBot — Cloudflare Worker

บอทเทรดตามกฎ **เฟส 1 = paper (จำลอง) เท่านั้น** ไม่ส่งคำสั่งซื้อขายจริง และไม่ต้องใส่ API key ของโบรกเกอร์

- ทุก 15 นาที: อ่านกฎ → ดึงราคา (`market-data.json` ของแอป + ราคา crypto สดจาก Binance) → ประเมินด้วย `autobot.js` (ไฟล์เดียวกับในแอป) → บันทึกพอร์ตจำลองลง KV
- แอป (เมนู พอร์ตลงทุน → บอทเทรด) ส่งกฎมาให้ และอ่านผลกลับไปแสดง

## ติดตั้ง (ครั้งเดียว ~10 นาที)

ต้องมีบัญชี Cloudflare (ฟรี) และ Node.js

```bash
cd cloudflare-worker/autobot
npx wrangler login
npx wrangler kv namespace create BOT        # เอา id ที่ได้ไปใส่ใน wrangler.toml
# แก้ wrangler.toml: MARKET_URL · ALLOWED_ORIGIN (ชื่อผู้ใช้ GitHub ของคุณ)
openssl rand -hex 32                          # สร้าง token ยาว ๆ แล้วคัดลอกไว้
npx wrangler secret put BOT_TOKEN             # วาง token
npx wrangler deploy                           # ได้ URL เช่น https://financetracker-autobot.<you>.workers.dev
```

แล้วในแอป: พอร์ตลงทุน → บอทเทรด → "เชื่อม Worker" → ใส่ URL + token เดียวกัน → "ส่งกฎไป Worker"

`wrangler deploy` จะรวม `../../autobot.js` เข้าไปให้เอง — แก้กฎการประเมินที่ไฟล์นั้นที่เดียว แล้ว deploy ใหม่

## ความปลอดภัย

- ทุก endpoint ต้องมี `Authorization: Bearer <BOT_TOKEN>` · token เทียบแบบเวลาคงที่ · CORS อนุญาตเฉพาะ `ALLOWED_ORIGIN`
- token เก็บในแอปเครื่องนี้ (เข้ารหัสถ้าตั้งรหัสผ่านไว้) — ถ้าหลุด: `npx wrangler secret put BOT_TOKEN` ใหม่
- เฟสนี้ไม่มี key โบรกเกอร์ในระบบเลย ต่อให้ token หลุดก็แก้ได้แค่กฎ/พอร์ตจำลอง

## เฟส 2 (เงินจริง) — ยังไม่ได้ทำ

ทำเมื่อผล paper น่าพอใจแล้วเท่านั้น สิ่งที่จะต้องมี:
- **Binance**: API key แบบ *Enable Spot Trading* อย่างเดียว **ปิด Withdraw** · จำกัด IP · เก็บเป็น Worker secret
- **หุ้นไทย**: Settrade Open API ผ่านโบรกเกอร์ที่รองรับ (ขอ App ID/Secret จากโบรกเกอร์) — ไม่ใช่ Streaming app โดยตรง
- **Dime / Streaming**: ไม่มี API ส่งคำสั่ง → บอทแจ้งเตือน "ถึงเงื่อนไขแล้ว ไปกดเองในแอป" (ต่อกับระบบแจ้งเตือนเดิม)
- วงเงินต่อวัน/ต่อคำสั่งที่ Worker บังคับเอง (ไม่เชื่อค่าจากแอปอย่างเดียว) · ปุ่มหยุดฉุกเฉิน · บันทึกทุกคำสั่ง
- ทุกคำสั่งจริงเป็นความเสี่ยงของเจ้าของบัญชี — ไม่ใช่คำแนะนำการลงทุน
