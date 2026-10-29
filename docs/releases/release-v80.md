# v80 — พอร์ตสด: BBTC คิดราคาตาม BTC

คำขอ: ใส่กระเป๋า MetaMask แล้วเหรียญ "Binance Wrapped BTC" (BBTC 0.0103 บน Ethereum) ไม่ขึ้น ·
ผู้ใช้เลือก (2026-10-29): **อิงราคา BTC** — ไม่ต้องมีหน้าตั้งค่าให้เลือกเอง

## ทำไมไม่มีราคา
ราคาในหน้าพอร์ตสดมาจากคู่ `<เหรียญ>USDT` บน Binance (รายชื่อคู่จาก `ticker/price` · กราฟจาก `klines` · ราคาสดจาก WebSocket) —
Binance ไม่มีคู่ `BBTCUSDT` จึงขึ้น "ไม่มีราคา" และไม่นับในมูลค่ารวม

## เปลี่ยนอะไร
- `js/liveport.js`: `PRICE_AS = { BBTC: 'BTC' }` + `priceAsset(a)` · `pricePair('BBTC')` → `BTCUSDT`
  - ตารางเดียว เพิ่มตัวอื่นเมื่อผู้ใช้ขอเท่านั้น — **ไม่จับคู่จากชื่อเหรียญอัตโนมัติ** (เหรียญปลอมชื่อเหมือนถูกส่งเข้ากระเป๋าบ่อย)
  - ต้นทุนไม่เปลี่ยน: ประวัติเทรด Binance ยังดึงคู่ของ BBTC เอง (ไม่มี → "ไม่มีประวัติเทรด") · ต้นทุนชีตยังดูชื่อ BBTC ใน Asset_Tracker
- `index.html` (หน้าพอร์ตสด): ราคา/กราฟ 24 ชม. เก็บตามสินทรัพย์ที่ใช้ราคา — BTC กับ BBTC ใช้ klines และ stream `btcusdt@miniTicker` ชุดเดียวกัน (ไม่ขอซ้ำ) ·
  การ์ด BBTC มีป้าย "ราคาตาม BTC / priced as BTC" (tooltip บอกเหตุผล) · หมายเหตุท้ายหน้าเพิ่ม "ยกเว้น BBTC ใช้ราคา BTC"
- build `v80` (`APP_BUILD` · `EXPECTED_SHARED_BUILD` · `CACHE_NAME`)

## ตรวจแล้ว
- `tests/test_liveport.cjs` +6 ข้อ (BBTC → BTCUSDT · ตัวอื่นไม่เปลี่ยน รวม WBTC/BTCB · stablecoin · ตารางมีแค่ BBTC · มูลค่า 0.0103 × ราคา BTC · ไม่เดาต้นทุน) · JS 16 ชุดผ่าน
- Chromium + Worker จำลอง (BTC ใน Binance · BBTC + ETH ใน MetaMask) + ราคา Binance จำลอง + WebSocket จำลอง:
  BBTC ได้ราคา BTC ทั้งตอนโหลดและตอนราคาสดเปลี่ยน · ไม่มีตัว "ไม่มีราคา" · klines ขอ BTCUSDT ครั้งเดียว · stream เดียว · ไม่มี JS error · 1366 ไทย / 375 อังกฤษ

## ผู้ใช้ต้องทำเอง
- ใส่ที่อยู่กระเป๋า (คัดลอกเต็มจาก MetaMask — ห้ามพิมพ์แบบที่ย่อ `0xd77E2…bca26`) + ติ๊ก Ethereum + เพิ่มเหรียญ BBTC ด้วยที่อยู่สัญญา (Ethereum) แล้วกดบันทึก
- ไม่ต้อง deploy Worker ใหม่ (Worker ไม่ได้ใช้ราคา) — merge แล้ว GitHub Pages อัปเดตเอง · แอปที่ติดตั้งไว้ปิด-เปิดหนึ่งครั้ง
