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

## พอร์ตสด (v78) — Binance + MetaMask แบบอ่านอย่างเดียว

Worker ตัวเดียวกันนี้ให้ข้อมูลหน้า **พอร์ตลงทุน → พอร์ตสด** ด้วย (ไม่ต้อง deploy แยก)

### 1. สร้าง API key ของ Binance แบบอ่านอย่างเดียว
Binance → Account → **API Management** → Create API → *System generated* (HMAC)
- ติ๊กเฉพาะ **Enable Reading** เท่านั้น
- **ห้าม** เปิด Enable Spot & Margin Trading · Enable Withdrawals · Futures · Margin · Universal Transfer
- IP access restrictions: เลือก *Unrestricted* — Cloudflare Worker ไม่มี IP ขาออกที่คงที่ ผูก IP ไม่ได้
  (ปลอดภัยเพราะ key อ่านได้อย่างเดียว · Worker ตรวจสิทธิ์ key ทุกชั่วโมง ถ้าพบว่าเปิดเทรด/ถอนได้ จะ **ไม่ใช้ key นั้นเลย**)

```bash
npx wrangler secret put BINANCE_KEY       # วาง API Key
npx wrangler secret put BINANCE_SECRET    # วาง Secret Key (Binance แสดงครั้งเดียว)
npx wrangler deploy                       # รวม ../../liveport.js เข้าไปให้เอง
```

### 2. MetaMask
ในแอป: พอร์ตสด → **กระเป๋า MetaMask** → ใส่ที่อยู่สาธารณะ (0x…) + เลือกเครือข่าย (Ethereum · BNB Chain · Arbitrum · Base · Optimism · Polygon)
- เหรียญหลัก (ETH/BNB/POL) อ่านให้อัตโนมัติ · เหรียญ ERC-20/BEP-20 ต้องเพิ่มที่อยู่สัญญาเอง (ชื่อ/ทศนิยมอ่านจาก blockchain)
- **ไม่ต้องใช้และห้ามใส่** seed phrase หรือ private key ที่ไหนทั้งสิ้น
- อ่านผ่าน RPC สาธารณะของ publicnode.com จาก Worker (IP ของคุณไม่ไปถึงผู้ให้บริการ RPC)

### ราคาและต้นทุน
- ราคาสด: แอปต่อ WebSocket สาธารณะของ Binance (`data-stream.binance.vision`) ตรงจากเบราว์เซอร์ — ไม่ผ่าน Worker ไม่ใช้ key
- "อัปเดตต้นทุนจาก Binance": Worker ดึง `myTrades` ของคู่ USDT/FDUSD/USDC ของทุกเหรียญที่ถือ เก็บใน KV (`liveTrades`)
  ครั้งแรกอาจกดแล้วรอหลายรอบ (ทีละ ~35 คำขอ เพราะ Worker ฟรีจำกัด 50 subrequest ต่อคำขอ) — แอปเรียกต่อให้เอง ครั้งถัดไปดึงเฉพาะของใหม่
- ซื้อผ่าน Convert / Auto-Invest / รางวัล Earn ไม่อยู่ใน `myTrades` → หน้าแอปบอก "มีประวัติซื้อ x%" แทนการเดาต้นทุน

### ถ้าเจอ HTTP 451
Binance ปฏิเสธคำขอจากบางประเทศ — Worker เรียก Binance เฉพาะตอนแอปขอ (รันที่ศูนย์ข้อมูลใกล้คุณ) ไม่เรียกใน cron
ถ้ายังเจอ 451 แปลว่าคำขอไปออกที่ศูนย์ข้อมูลในประเทศที่ถูกบล็อก (เช่นใช้ VPN) — ปิด VPN แล้วลองใหม่

## ความปลอดภัย

- ทุก endpoint ต้องมี `Authorization: Bearer <BOT_TOKEN>` · token เทียบแบบเวลาคงที่ · CORS อนุญาตเฉพาะ `ALLOWED_ORIGIN`
- token เก็บในแอปเครื่องนี้ (เข้ารหัสถ้าตั้งรหัสผ่านไว้) — ถ้าหลุด: `npx wrangler secret put BOT_TOKEN` ใหม่
- (v78) ถ้าใส่ BINANCE_KEY แล้ว **BOT_TOKEN ใช้เปิดดูยอดเงินจริงได้** (แต่โอน/เทรด/ถอนไม่ได้ เพราะ key อ่านอย่างเดียวและ Worker ไม่มี endpoint ส่งคำสั่ง)
  → ใช้ token ยาว (`openssl rand -hex 32`) และตั้งรหัสผ่านในแอปเพื่อให้ token ถูกเข้ารหัสในเครื่อง · สงสัยว่าหลุด: เปลี่ยน BOT_TOKEN และลบ/สร้าง API key ใหม่ที่ Binance
- ไม่มีโค้ดส่งคำสั่งซื้อขายหรือถอนใน Worker (เทสต์ `scripts/test_autobot_worker.mjs` ตรวจข้อนี้)

## เฟส 2 (เงินจริง) — ยังไม่ได้ทำ

ทำเมื่อผล paper น่าพอใจแล้วเท่านั้น สิ่งที่จะต้องมี:
- **Binance**: API key แบบ *Enable Spot Trading* อย่างเดียว **ปิด Withdraw** · เก็บเป็น Worker secret · ⚠ Worker ไม่มี IP ขาออกที่คงที่ จึงจำกัด IP ของ key ไม่ได้ (พบตอนทำ v78) — ต้องตัดสินใจเรื่องนี้ก่อนเปิดสิทธิ์เทรด
- **หุ้นไทย**: Settrade Open API ผ่านโบรกเกอร์ที่รองรับ (ขอ App ID/Secret จากโบรกเกอร์) — ไม่ใช่ Streaming app โดยตรง
- **Dime / Streaming**: ไม่มี API ส่งคำสั่ง → บอทแจ้งเตือน "ถึงเงื่อนไขแล้ว ไปกดเองในแอป" (ต่อกับระบบแจ้งเตือนเดิม)
- วงเงินต่อวัน/ต่อคำสั่งที่ Worker บังคับเอง (ไม่เชื่อค่าจากแอปอย่างเดียว) · ปุ่มหยุดฉุกเฉิน · บันทึกทุกคำสั่ง
- ทุกคำสั่งจริงเป็นความเสี่ยงของเจ้าของบัญชี — ไม่ใช่คำแนะนำการลงทุน
