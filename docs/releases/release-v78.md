# v78 — พอร์ตสด (Binance + MetaMask · อ่านอย่างเดียว · ราคา realtime)

คำขอ: "เชื่อมข้อมูลผ่านโบรกต่าง ๆ และแสดง dashboard พอร์ตลงทุนแบบ realtime — ดูตัวที่ลงทุนแล้วแจ้ง P&L แบบ real time" (แนบภาพตัวอย่าง 2 ภาพ)
ผู้ใช้เลือก: crypto อยู่ที่ **Binance + MetaMask** · โอเคที่จะเก็บ read-only key เป็น secret ใน Cloudflare Worker · ต้นทุน **แสดงทั้ง 2 แหล่งไว้เปรียบเทียบ** (ชีต vs ประวัติเทรด Binance)
ยังไม่ได้ระบุโบรกเกอร์หุ้นไทย → Settrade ยังไม่ทำในรอบนี้

## ทำอะไร

**ไม่มีการส่งคำสั่งซื้อขายหรือถอนที่ไหนเลย** — หน้าไม่มีปุ่ม Deposit/Trade · Worker ไม่มี endpoint ส่งคำสั่ง · key Binance ต้องอ่านได้อย่างเดียว (Worker ตรวจเอง)

| ส่วน | ไฟล์ |
|---|---|
| ตัวคำนวณล้วน (ไม่มี network/DOM) ใช้ร่วมแอป + Worker: รวมยอด · WACC จากประวัติเทรด · มุมมอง 2 ฐานต้นทุน · EVM JSON-RPC encode/decode · ตรวจค่าตั้งกระเป๋า | `liveport.js` · เทสต์ `scripts/test_liveport.cjs` (47 ข้อ) |
| Worker (ตัวเดิมของบอท): `GET /live/holdings` · `POST /live/costs` · `GET/PUT /live/config` | `cloudflare-worker/autobot/worker.js` · เทสต์เพิ่มใน `scripts/test_autobot_worker.mjs` (+16 ข้อ) |
| หน้า พอร์ตลงทุน → **พอร์ตสด** (`live`) + หน้าต่าง "กระเป๋า MetaMask" | `index.html` (`renderLive` · `_lvPaint` · `_lvWsOpen` · `lvUpdateCost` · `lvOpenCfg`) |

### ข้อมูลมาจากไหน
- **ยอด Binance**: Spot (`/api/v3/account`) · Funding · Simple Earn ยืดหยุ่น/ล็อก — เซ็น HMAC ใน Worker · endpoint รองล้ม = คำเตือน ไม่ล้มทั้งหน้า
- **ยอด MetaMask**: ที่อยู่สาธารณะ + เครือข่ายที่เลือก (Ethereum · BNB Chain · Arbitrum · Base · Optimism · Polygon) → JSON-RPC แบบ batch ไป publicnode (1 คำขอต่อเครือข่าย) · เหรียญ ERC-20 เพิ่มด้วยที่อยู่สัญญา (ชื่อ/ทศนิยมอ่านจาก chain ตอนบันทึก)
- **ราคาสด**: เบราว์เซอร์ต่อ WebSocket สาธารณะ `data-stream.binance.vision` (`<pair>@miniTicker`) ตรง · อัปเดตตัวเลขอย่างมากวินาทีละครั้ง (แก้เฉพาะตัวเลข ไม่ render ทั้งหน้า) · กราฟ 24 ชม. จาก klines 1h
- ยอดคงเหลือดึงใหม่ทุก 60 วิ ขณะเปิดหน้านี้ · ออกจากหน้า/สลับแอป → ปิด WebSocket และหยุดดึง

### ต้นทุน 2 แหล่ง (ในการ์ดทุกตัว + การ์ดสรุป · ปุ่มสลับว่าตัวเลขใหญ่ใช้ฐานไหน)
- **ชีต**: `waccMap` (running WACC จาก Asset_Tracker · บาท/หน่วย · รวมทุกแพลตฟอร์ม) × จำนวนที่ถือจริงตอนนี้ · แสดงจำนวนที่ชีตบันทึกไว้ข้าง ๆ — ต่างเกิน 0.5% เป็นสีส้ม
- **Binance**: running WACC จาก `myTrades` ของคู่ USDT/FDUSD/USDC ทุกคู่รวมกันเรียงตามเวลา (ขายจากคู่หนึ่งหักต้นทุนที่ซื้อจากอีกคู่)
  - ค่าธรรมเนียมเป็นเหรียญที่ได้ → ได้เหรียญน้อยลง · เป็น stablecoin → บวกต้นทุน · เป็น BNB → **ไม่บวก** (ไม่รู้ราคาตอนนั้น) แต่แสดงแยก
  - นับ P&L เฉพาะส่วนที่มีประวัติซื้อ แสดง "มีประวัติซื้อ x%" — ของจาก Convert / Auto-Invest / ฝากจากที่อื่น / รางวัล Earn ไม่อยู่ใน `myTrades` ไม่เดาต้นทุนให้
  - การ์ดสรุปฐาน Binance ไม่นับ stablecoin (P&L = 0 เสมอ ถ้านับจะดูเหมือนมีต้นทุนแล้วทั้งที่ยังไม่ได้ดึงประวัติ)
  - ดึงประวัติ: ปุ่ม "อัปเดตต้นทุนจาก Binance" → Worker ดึงทีละ ≤ 35 คำขอ (Worker ฟรีจำกัด 50 subrequest) แอปเรียกต่อจนครบ · เก็บแบบย่อใน KV `liveTrades` · ครั้งต่อไปดึงเฉพาะ id ใหม่ · คู่ที่ไม่มีบน Binance (-1121) จำไว้ไม่เรียกซ้ำ

### กันพลาด/ความปลอดภัย
- Worker เรียก `/sapi/v1/account/apiRestrictions` (cache 1 ชม.) — key ที่เปิดเทรด/ถอน/margin/futures/โอนภายใน → **ไม่ใช้เลย** แสดงข้อความให้สร้าง key ใหม่
- key อยู่ใน Worker secret เท่านั้น ไม่เคยผ่านเบราว์เซอร์ · ที่อยู่กระเป๋าเก็บใน Worker KV (`liveCfg`)
- Binance ปฏิเสธบางประเทศ (451) → เรียก Binance เฉพาะตอนแอปขอ (รันที่ศูนย์ข้อมูลใกล้ผู้ใช้) ไม่เรียกใน cron
- คำตอบ 400 ของ data-api Binance ไม่มี CORS header (เบราว์เซอร์แยก "ไม่มีคู่" กับ "เน็ตล่ม" ไม่ได้) → ดึงรายชื่อคู่ทั้งหมดจาก `ticker/price` ครั้งเดียวแล้วเทียบ
- ไม่มีราคา → ไม่คิดมูลค่า/P&L (ไม่แสดงเป็น 0) และนับ "x ตัวไม่มีราคา" ในยอดรวม

## ตรวจแล้ว
- เทสต์ JS 16 ชุดผ่าน (ใหม่ `test_liveport.cjs` · Worker เพิ่มส่วนพอร์ตสด: auth · config ผิด/ถูก · เติม symbol จาก chain · funding ล้ม = คำเตือน · ดึงประวัติ 2 หน้า + ต่อจาก id ล่าสุด · คู่ไม่มี · key ที่เปิดเทรด/ถอน → ไม่ใช้ · ไม่มี endpoint ส่งคำสั่ง/ถอน)
- เบราว์เซอร์จริง: Worker จริง (`worker.js`) รันใน Node + Binance จำลอง + **RPC จริง** (อ่านยอดจริงของที่อยู่สาธารณะบน Ethereum/Base/Arbitrum · เพิ่ม USDC/USDT ด้วยที่อยู่สัญญาแล้วอ่านชื่อ/ทศนิยมจาก chain ได้) · **WebSocket ราคาจริงจาก Binance** ขึ้นสถานะ "ราคาสด"
- ต้นทุน Binance ตรงกับคำนวณมือ (ETH ซื้อ 6 ครั้ง ค่าธรรมเนียมเป็น ETH แล้วขาย 0.3 → เหลือ 1.1985 · $2,752.75/หน่วย · BTC ค่าธรรมเนียม BNB แสดงแยก 0.0004)
- สลับหน้าออก → WebSocket ปิด · กลับมา → ต่อใหม่ · ไม่มี JS error · 1366 dark/light · มือถือ 375px ไม่ล้นจอ · TH/EN
- **ยังไม่ได้ลองกับบัญชี Binance จริง / Worker บน Cloudflare จริง** (ยังไม่ deploy — ขั้นตอนใน `cloudflare-worker/autobot/README.md` หัวข้อ "พอร์ตสด")

## ยังไม่ทำ (รอบถัดไป ถ้าต้องการ)
- หุ้นไทยผ่าน Settrade Open API — ต้องรู้ว่าโบรกเกอร์รองรับ Open API ไหม
- ประวัติ Convert (`/sapi/v1/convert/tradeFlow` · ช่วงละ ≤ 30 วัน) และ Auto-Invest เพื่อเพิ่มความครอบคลุมของต้นทุน Binance
- ค่าธรรมเนียม BNB แปลงเป็น USD ด้วยราคา BNB ณ เวลาเทรด (klines ย้อนหลัง)
- เหรียญที่ไม่มีคู่ USDT บน Binance ยังไม่มีราคา (เช่นเหรียญ DeFi เล็ก ๆ ใน MetaMask)
