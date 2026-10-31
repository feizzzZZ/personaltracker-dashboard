# v82 — หน้าปันผล: กราฟ Yield / Payout (แบบ Snowball)

คำขอ (2026-10-31): ปรับหน้าปันผลตามภาพ Snowball ที่แนบ — **รอบนี้ทำข้อ 1 ก่อน** (ผู้ใช้จะมาปรับต่อ):
กราฟ Yield/Payout มี dropdown ไม่มีกรอบ 2 ตัว — ค่าที่แสดง **Yield (%) / Annual Payout (บาท)** และการจัดกลุ่ม
**Holdings** (รายตัว) · **Categories** (ประเภทสินทรัพย์ เช่น fund, stock) · **Sectors** (อุตสาหกรรม เช่น Walmart = ค้าปลีก)

## ตัวเลข
| | นิยาม |
|---|---|
| ปันผลต่อปี (บาท) รายตัว | คาดการณ์ 12 เดือนข้างหน้า (`dividendCalendar().byTicker` — ชุดเดียวกับการ์ด "คาดการณ์" ที่มีอยู่ · ก่อนหักภาษี) · ตัวที่ไม่มีข้อมูลคาดการณ์ใน `fundamentals.json` → ยอดที่ได้รับจริง 12 เดือนล่าสุดจาก Asset_Tracker |
| Yield (แท่ง) | ปันผลต่อปี ÷ มูลค่าวันนี้ |
| Yield on cost (ขีด) | ปันผลต่อปี ÷ ต้นทุน (WACC × จำนวนที่ถือ) — เหมือนขีดในภาพ Snowball |
| Holdings | เฉพาะตัวที่มีปันผล |
| Categories / Sectors | หารด้วยมูลค่า/ต้นทุน **ทั้งกลุ่ม** รวมตัวที่ไม่จ่าย (= yield จริงของเงินก้อนนั้น) · แสดงเฉพาะกลุ่มที่มีปันผล |
| Sectors มาจาก | ช่อง **Industry** ใน Asset_Tracker (`fundamentals.json` ไม่มี sector) · ว่าง/"—" → "ไม่ระบุอุตสาหกรรม" |
| เรียง | มาก → น้อยตามค่าที่เลือก · ตัวที่ไม่มีราคา (Yield คิดไม่ได้) ไว้ท้าย แต่ยังเห็นยอดบาท |

แถวสรุปเหนือกราฟ: Yield · Yield on cost · ปันผลต่อปี + ต่อเดือน (ทั้งพอร์ต) · tooltip รายแท่ง: ปันผลต่อปี + ที่มา (คาดการณ์/ได้รับจริง) · มูลค่า · Yield · YOC · กลุ่ม: รายชื่อตัวที่จ่าย ·
หมายเหตุใต้กราฟบอกนิยามและจำนวนตัวที่ใช้ยอดได้รับจริงแทนคาดการณ์

## โค้ด
- `shared.js`: `dividendCalendar` คืน `byTicker` เพิ่ม (ผลรวม = `annual` เสมอ) · `dividendYieldView(holdings, fwdByTk, rec12ByTk, by, sortBy)` · `DIV_NO_SECTOR`
- `index.html`: `_dvCal()` คำนวณปฏิทินปันผลครั้งเดียวต่อการ render (ตัวติดตามปันผล + กราฟใช้ร่วม — เดิมอยู่ใน `renderDividendTracker`) · `renderDvYield()` ·
  การ์ด `.dv-yp` ต่อจากการ์ด "ประวัติที่ได้รับจริง" · dropdown ไม่มีกรอบ (`.dv-sel` + ลูกศร CSS · `field-sizing:content` ให้กว้างเท่าข้อความ) · จำค่าที่เลือกใน `finOS_dvYp` (เฉพาะเครื่อง) ·
  กราฟแสดงได้แม้ชีตยังไม่มีแถว Dividend Payout (ใช้คาดการณ์)
- build `v82`

## ตรวจแล้ว
- `tests/test_dividends.cjs` +17 ข้อ (byTicker = annual · คาดการณ์ก่อนได้รับจริง · Yield/YOC · เรียง · Categories หารทั้งกลุ่ม · ไม่แสดงกลุ่มไม่มีปันผล · Sectors จาก Industry · ไม่ระบุ · ไม่มีราคา) · JS 17 ชุดผ่าน
- Chromium + `fundamentals.json` จริงใน repo + Asset_Tracker จำลอง (GOOGL · JEPI · WMT · COKE · KBANK · กองทุนสำรองเลี้ยงชีพ) + Chart.js 4.4.1 (ตัวเดียวกับ CDN):
  ทุกคู่ dropdown วาดถูก · ยอดคาดการณ์รายตัวรวม = การ์ดคาดการณ์เดิม (฿10,644) · YOC ตรงคำนวณมือ (JEPI 7.77% · KBANK 10%) · กองทุนสำรองฯ ไม่จ่าย → ไม่ขึ้นใน Categories ·
  จำค่าที่เลือกหลัง render ใหม่ · ทุกหน้าในเมนูเปิดได้ไม่มี error · 1366 ไทย / 375 อังกฤษ · มือถือไม่ล้นจอ

## ยังไม่ทำ (ภาพที่แนบ — รอผู้ใช้สั่งทีละข้อ)
Passive income diversification (โดนัท + Holdings/Sectors) · Average annual growth · Future payments · Dividends received (ปี/เดือน + รายตัว) · Dividend growth (เทียบรายเดือนข้ามปี)
