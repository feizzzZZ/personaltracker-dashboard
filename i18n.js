/* ══ i18n.js — สลับภาษาไทย / English (v65) ═══════════════════════════════
   ขอบเขต: โครงหน้า + ป้ายหลัก (เมนู แท็บ หัวข้อ/คำอธิบายหน้า หัวการ์ด หัวตาราง ปุ่ม ฟอร์ม สถานะ)
   ข้อความวิเคราะห์ยาว ๆ ที่สร้างจากตัวเลข (Analyst Desk · คำอธิบายกติกา) ยังเป็นภาษาไทย

   วิธีทำงาน — แปลที่ "ปลายทาง" ไม่แตะ template หลายร้อยจุดในแอป:
   • text node / title / placeholder / aria-label ที่ข้อความ (ตัดช่องว่างซ้ำแล้ว) ตรงกับ DICT ทั้งก้อน
     หรือตรงกับ RULES (regex สำหรับป้ายที่มีตัวเลขแทรก) → แทนด้วยภาษาอังกฤษ
   • MutationObserver จับเนื้อหาที่ JS render ใหม่ทุกครั้ง → หน้าใหม่แปลเองโดยไม่ต้องเรียก
   • เก็บต้นฉบับไว้ใน WeakMap → สลับกลับเป็นไทยได้ทันทีโดยไม่ต้องโหลดหน้าใหม่
   • ข้ามทุกอย่างใน [data-no-i18n] · <script> · <style> · <textarea>

   เพิ่มคำแปล: ใส่คู่ 'ไทย':'English' ใน DICT (คีย์ = ข้อความตามที่เห็นบนจอ ช่องว่างหลายตัวยุบเป็นตัวเดียว) */
(function(){
'use strict';

const DICT = {
  // ── เมนู / แท็บ / กลุ่ม ──────────────────────────────────────────────
  'ภาพรวม':'Overview', 'บทวิเคราะห์':'Analysis', 'เป้าหมาย':'Goals', 'เงิน':'Money',
  'เงินเข้า-ออก':'Cash flow', 'บัญชี & หนี้':'Accounts & Debt', 'ประกัน':'Insurance',
  'ลงทุน':'Invest', 'พอร์ตลงทุน':'Portfolio', 'ปันผล':'Dividends', 'ตลาด & จังหวะ':'Markets & Timing',
  'พอร์ต':'Portfolio', 'ตลาด':'Markets', 'อื่น ๆ':'More',
  'รายเดือน':'Monthly', 'รายปี':'Yearly', 'ออม & ลงทุน':'Save & Invest', 'งบประมาณ':'Budget',
  'บัญชี':'Accounts', 'หนี้':'Debt', 'ภาพรวมพอร์ต':'Portfolio', 'รายการซื้อขาย':'Trades',
  'ขายแล้ว':'Realized', 'ไม่มีใครดูแล':'Dormant', 'ต้นทุน & ค่าเงิน':'Costs & FX',
  'สัญญาณรายตัว':'Signals', 'ภาพรวมตลาด':'Market overview', 'บอทจำลอง':'Paper bot', 'ตลาดวันนี้':'Market today',
  'เมนู':'Menu', 'เมนูหลัก':'Main menu', 'เมนูทั้งหมด':'All menus', 'ย่อเมนู':'Collapse menu', 'ขยายเมนู':'Expand menu',
  'กำลังโหลด...':'Loading...', 'sync ข้อมูลสดจากชีตของคุณ':'sync live data from your sheet',
  'ดึงข้อมูลล่าสุดจาก Google Sheets':'Fetch the latest data from Google Sheets',
  'ตั้งค่า Client ID / Spreadsheet ID':'Settings: Client ID / Spreadsheet ID',
  'สำรองการตั้งค่า + ประวัติ TWR เป็นไฟล์ JSON':'Back up settings + TWR history as JSON',
  'กู้คืนจากไฟล์ backup':'Restore from a backup file',
  'สลับภาษา':'Switch language', 'สลับธีม':'Switch theme',

  // ── หัวหน้า / คำอธิบายหน้า ────────────────────────────────────────────
  'ภาพรวมทางการเงินทั้งหมด':'Your complete financial picture',
  'รายรับ-รายจ่ายรายเดือน':'Monthly income & expenses',
  'เปรียบเทียบรายได้-รายจ่ายรายปี':'Year-by-year income vs expenses',
  'ยอดคงเหลือแยกบัญชี':'Balance by account',
  'สินทรัพย์ทั้งหมด · WACC · True Cost · P&L':'All assets · WACC · True Cost · P&L',
  'ตั้ง budget รายเดือน · แจ้งเตือนเมื่อใกล้เกิน':'Monthly budgets · alerts when close to the limit',
  'ภาพรวมความคุ้มครอง · เบี้ยประกัน · กรมธรรม์ทั้งหมด':'Coverage overview · premiums · all policies',
  'กำไร/ขาดทุนจาก sell transactions ทั้งหมด':'Profit / loss from all sell transactions',
  'หนี้ที่มีดอกเบี้ยเดิน — ผลตอบแทนรับประกันที่สูงที่สุดในพอร์ตคุณ':'Interest-bearing debt — the highest guaranteed return in your portfolio',
  'ฝั่งซ้ายของสมการความรวย — เก็บได้กี่ % และเอาไปลงทุนจริงกี่ %':'The left side of the wealth equation — how much you save, and how much you actually invest',
  'รายได้ที่ไม่ต้องทำงาน — เงินทำงานแทนคุณเดือนละเท่าไหร่แล้ว':'Passive income — how much your money earns for you each month',
  'ตั้งเป้าและติดตามความคืบหน้า':'Set goals and track progress',
  'เงินที่ไม่มีใครดูแล':'Unattended money',
  'ต้นทุนที่มองไม่เห็น':'Hidden costs',
  'ค่าธรรมเนียม ภาษี และความเสี่ยงค่าเงิน':'Fees, taxes and currency risk',
  'RSI · เทรนด์ · ระยะห่างจากจุดสูงสุด — คำนวณใน pipeline ไม่ใช่ที่หน้าเว็บ เพื่อให้สูตรมีที่เดียว':'RSI · trend · distance from high — computed in the pipeline, not the browser, so each formula lives in one place',
  'บอทจำลอง (Paper)':'Paper bot',
  'พอร์ตทดลองที่ซื้อตามสัญญาณ เทียบกับพอร์ตที่ DCA เฉย ๆ — ไม่ใช่เงินจริง ไม่มีคำสั่งซื้อขายออกไปที่ไหน':'A simulated portfolio that buys on signals, compared with plain DCA — not real money, no orders are ever sent',
  'ข้อมูลดิบที่สดจริงเท่านั้น — ไม่ให้คะแนน ไม่แนะนำให้ซื้อขาย':'Fresh raw data only — no scores, no buy/sell advice',
  'นักวิเคราะห์ 5 คน อ่านข้อมูลชุดเดียวกัน แต่ตอบคนละคำถาม':'5 analysts read the same data but answer different questions',
  'บทวิเคราะห์ทั้งหมดคำนวณในเครื่องจากข้อมูลของคุณเอง ไม่ส่งออกไปไหน และให้คำตอบเดิมเสมอกับข้อมูลชุดเดิม · เป็นการอ่านตัวเลขให้ฟัง ไม่ใช่คำแนะนำการลงทุน การตัดสินใจสุดท้ายเป็นของคุณ':'All analysis is computed on this device from your own data, nothing is sent anywhere, and the same data always gives the same answer · It reads the numbers back to you — it is not investment advice. The final decision is yours.',

  // ── Overview ───────────────────────────────────────────────────────
  'Cash (ใช้ได้จริง)':'Cash (spendable)', 'มูลค่าเวนคืน':'Surrender value',
  'ยังไม่ได้ใส่ดอกเบี้ย →':'Interest rate not set →',
  'ยอดบัญชียังไม่เคย verify กับธนาคาร':'Account balances never verified with the bank',
  'เป้าหมาย ›':'Goals ›', 'ปกติ':'Normal', 'ข้อมูล สดใหม่ ›':'Data fresh ›',
  '🎉 ถึงเป้าปลายทาง':'🎉 Final goal reached', 'เกินเป้ามา':'Over the goal by',
  '· ตั้งเป้าใหม่ได้ในหน้าเป้าหมาย':'· set a new goal on the Goals page',
  'ย่อ ▴':'Collapse ▴',

  // ── Cash flow / yearly / budget ────────────────────────────────────
  '(รายได้ − รายจ่าย) ÷ รายได้':'(income − expenses) ÷ income',
  'หนี้ & บัตร (Debt)':'Debt & cards', 'หนี้ & บัตร':'Debt & cards',
  'แตะเพื่อแก้ไข':'Tap to edit',
  'Budget ต่อ category':'Budget by category',
  'คลิก "Edit" เพื่อตั้งค่า · บันทึกอัตโนมัติ':'Click "Edit" to set · saved automatically',
  'บันทึก':'Save', 'เกินแล้ว!':'Over!', 'ใกล้เกิน':'Near limit', 'ใช้เท่ากับเป้าหมาย':'Exactly on budget',
  'กำลังดี':'On track', 'ต่ำกว่า target':'Below target', 'ถึง target!':'Target hit!', 'ยังไม่ตั้ง':'Not set',
  '✓ ถึง target แล้ว!':'✓ Target reached!',
  'ผลรวมแถวประเภท Debt = ยอดรูดบัตร (แถวที่แตะบัญชีบัตรเครดิต) + ค่างวด/ใช้หนี้ที่จ่ายจากบัญชีธนาคาร · การจ่ายบัตรจากธนาคารหักล้างกันเองในแถวเดียว ไม่นับซ้ำ':'Sum of Debt rows = card spending (rows touching a credit card) + instalments/repayments from bank accounts · card payments from the bank net out within one row and are not double-counted',
  'ผลรวมแถวประเภท Debt = ยอดรูดบัตร + ค่างวด/ใช้หนี้จากบัญชีธนาคาร · ชี้ที่ตัวเลขเพื่อดูแยก':'Sum of Debt rows = card spending + instalments/repayments from bank accounts · hover a number for the split',

  // ── Accounts / debt ────────────────────────────────────────────────
  'เดือน':'Month', 'ปลอดภัย':'Safe', 'NET CASH · ยอดรวมทุกบัญชี':'NET CASH · all accounts',
  'ไม่มีหนี้ค้างในบัญชี':'No outstanding debt in accounts',
  'ยังไม่ได้ตั้งค่า Reconciliation':'Reconciliation not set up',
  '🎉 ไม่มีหนี้ในระบบ':'🎉 No debt on record',
  'บัญชีที่ type = Credit Card หรือยอดติดลบจะถูกนับเป็นหนี้อัตโนมัติ':'Accounts with type = Credit Card or a negative balance are counted as debt automatically',
  'ยอดหนี้รวม':'Total debt', 'ดอกเบี้ยที่จ่ายอยู่':'Interest being paid', 'ต่อเดือน':'per month',
  'ยอดค้าง':'Balance', 'ปลอดดอกเบี้ย':'Interest-free', 'คิดดอกจริง':'Interest-bearing',
  'ดอกเบี้ย %/ปี':'Interest %/yr', 'ดอกเบี้ย/เดือน':'Interest/mo', 'ขั้นต่ำ/เดือน':'Minimum/mo',
  'ใส่ดอกเบี้ยด้านล่างก่อน':'Enter interest rates below first',
  '⚠️ ยังไม่ได้ใส่ดอกเบี้ย':'⚠️ Interest rates not set',
  '⚠ ยอดหนี้บางส่วนยังไม่ถูกตรวจสอบ':'⚠ Some debt balances are unverified',
  'ใช้ยอดคำนวณจากธุรกรรมที่กรอกมือ':'using balances computed from manually entered transactions',
  'หนี้ก้อนนี้มาจากอะไร · แยกตามประเภทธุรกรรมที่โพสต์เข้าบัญชีนั้นจริง':'Where this debt came from · by transactions actually posted to each account',
  'รูดสะสม':'Total charged', 'ชำระคืนสะสม':'Total repaid', 'ชำระคืนแล้ว':'Repaid',
  'ของยอดที่รูดทั้งหมด':'of everything charged', 'ยังไม่มียอดรูด':'No charges yet',
  'ดูรายละเอียดหนี้':'View debt details',

  // ── Portfolio / flow / realized / dormant / cost ───────────────────
  '+ เพิ่มรายการลงทุน':'+ Add investment', '📈 เพิ่มรายการลงทุน':'📈 Add investment',
  'กำไรที่ยังไม่ขาย (Unrealized)':'Unrealized gain',
  'True Performance — ผลตอบแทนที่แท้จริง':'True Performance — your real return',
  'ผลตอบแทนต่อปี ถ่วงตามวันที่เงินเข้าจริง — เลขเดียวที่ตอบว่า "DCA ของฉันคุ้มไหม"':'Annual return weighted by when money actually went in — the one number that answers "is my DCA worth it?"',
  '🚀 เครื่องยนต์ของพอร์ต (XIRR สูงสุด)':'🚀 Portfolio engines (highest XIRR)',
  '⚓ ตัวถ่วง (XIRR ต่ำสุด)':'⚓ Drags (lowest XIRR)',
  'ลงทุนอยู่ที่ไหนบ้าง':'Where your investments are', 'แยกตาม exchange / broker / wallet':'by exchange / broker / wallet',
  'เงินลงทุนรายเดือน/รายปี':'Invested per month / year', 'รายการลงทุนล่าสุด':'Latest investment transactions',
  'จำนวน':'Quantity', 'ราคา':'Price', 'รวม (บาท)':'Total (THB)',
  'ลงไป':'Put in', 'ได้คืน':'Got back', '· เหลือ':'· remaining',
  '(real return — กำลังซื้อที่เพิ่มขึ้นจริง)':'(real return — actual gain in purchasing power)',
  '⏳ สะสมข้อมูล':'⏳ Collecting data',
  'ตั้งใจถือ (Core)':'Intentional hold (Core)', 'ยัง Active — ซื้อสม่ำเสมอ':'Still active — bought regularly',
  'เงินที่จมอยู่':'Money parked', 'ผลตอบแทน (เฉพาะที่มีราคา)':'Return (priced assets only)',
  'ปันผลที่ได้รับ':'Dividends received', 'ยังจ่ายอยู่แม้หยุดซื้อ':'still paying although you stopped buying',
  'เทียบกับกลุ่ม Active':'Compared with the Active group', 'ตั้งใจถือ':'Intentional hold',
  'ไม่มีรายการที่หลุดจากเรดาร์ 👍':'Nothing has fallen off the radar 👍',
  'ยังไม่ได้ทำเครื่องหมายรายการใด':'No items marked yet',
  'สินทรัพย์':'Asset', 'ต้นทุน':'Cost', 'มูลค่า':'Value', 'ซื้อ':'Buys', 'หยุดมาแล้ว':'Stopped for',
  'ค่าธรรมเนียม+ภาษีสะสม':'Cumulative fees + taxes', 'สัดส่วนอิงดอลลาร์':'USD-linked share',
  'ความเสี่ยงค่าเงิน':'Currency risk', 'USD/THB ตอนนี้':'USD/THB now',
  'โดยที่ราคาสินทรัพย์ไม่ได้เปลี่ยนเลย':'without the asset prices changing at all',

  // ── Insurance ──────────────────────────────────────────────────────
  'เบี้ยรายปี':'Annual premium', 'กรมธรรม์ทั้งหมด':'All policies', 'ความคุ้มครองตามประเภท':'Coverage by type',
  'คลิกเพื่อดูรายละเอียด':'Click for details', 'รายละเอียด':'Details', 'ยังไม่มีข้อมูลประกัน':'No insurance data yet',
  'เบี้ยรวมต่อปี (active) · คลิกดู breakdown':'Total annual premium (active) · click for breakdown',
  'มูลค่าเวนคืนรวม':'Total surrender value', 'บาท':'THB', 'บาท/ปี':'THB/yr', 'บาท/ครั้ง':'THB/visit',
  'เพิ่ม sheet "Insurance_Policies" และ "Insurance_Coverage" ในไฟล์ Excel แล้ว upload ใหม่':'Add the "Insurance_Policies" and "Insurance_Coverage" sheets, then sync again',

  // ── Analyst desk (หัวการ์ด/ป้าย) ──────────────────────────────────────
  'คุณภาพผลตอบแทน':'Return quality', 'จุดที่จะเจ็บถ้าตลาดพัง':'Where it hurts if markets crash',
  'เก็บได้จริงเท่าไร รั่วตรงไหน':'What you really save, and where it leaks',
  'หนี้โตหรือลด · โปะหรือลงทุน':'Is debt growing or shrinking · pay down or invest',
  'อีกกี่ปีถึงอิสรภาพ':'Years to financial freedom',
  'เฝ้าดู':'Watch', 'ผ่าน':'Pass', 'สิ่งที่ควรทำต่อ':'Next steps',

  // ── Engine / dividends ─────────────────────────────────────────────
  '⚠ เงินที่เก็บได้แต่ยังไม่ลงทุน':'⚠ Saved but not yet invested',
  'รายได้เฉลี่ย / เดือน':'Average income / month',
  'Income · Expense · Invested รายเดือน':'Income · Expense · Invested per month',
  'Rate Trend — เก็บได้ vs ลงทุนจริง (%)':'Rate trend — saved vs actually invested (%)',
  'รายละเอียดรายเดือน':'Monthly details',
  'รายได้':'Income', 'รายจ่าย':'Expenses', 'เก็บได้':'Saved', 'ค้างในบัญชี':'Left in account',
  'ปันผลรวมทั้งหมด':'Total dividends', 'ปันผลรายเดือน':'Dividends by month', 'ปันผลรายปี':'Dividends by year',
  'ผู้จ่ายปันผล — เรียงตามยอดรวม':'Dividend payers — by total',
  'ประเภท':'Type', 'จำนวนครั้ง':'Payments', 'ปันผลรวม':'Total dividends', 'Yield on cost /ปี':'Yield on cost /yr',
  'ล่าสุด':'Latest', '% ของปันผลทั้งหมด':'% of all dividends',

  // ── Goals ──────────────────────────────────────────────────────────
  'ปันผลครอบคลุมรายจ่ายกี่ %':'% of expenses covered by dividends',
  'ยังไม่มี goal — กด "Add goal" เพื่อเริ่มต้น':'No goals yet — press "Add goal" to start',
  'เช่น กองทุนฉุกเฉิน / ซื้อ MacBook / เที่ยวญี่ปุ่น':'e.g. emergency fund / new MacBook / trip to Japan',
  'เก็บเงินถึง ฿X':'Save up to ฿X', 'save X% ต่อเดือน':'save X% per month',

  // ── Signals / watch / bot / market ─────────────────────────────────
  'ไม่มีสัญญาณเตือนระดับตลาด':'No market-level warnings',
  'สัญญาณขัดกัน — ไม่ใช่จังหวะเดิมพันหนักด้านใดด้านหนึ่ง':'Signals conflict — not the time to bet heavily either way',
  'ระวัง':'Caution', 'เป็นกลาง':'Neutral', 'เปิดรับความเสี่ยง':'Risk-on', 'แนวทาง':'Approach',
  'เงินเฟ้อ US (CPI YoY)':'US inflation (CPI YoY)', 'ความเครียดเครดิต (HYG/IEF)':'Credit stress (HYG/IEF)',
  'ผ่านประตู':'Passed gate', 'ไม่ผ่านประตู':'Failed gate', 'ไม่ผ่าน':'Fail', 'ยังไม่รู้':'Unknown',
  'ถ้ามีเงินก้อนถัดไป — เรียงตามอันดับ':'If you have new money — ranked',
  'ผ่านประตู — เทรนด์ยาวยังอยู่':'Passed gate — long trend intact',
  '① ประตู':'① Gate', '② อันดับ':'② Rank', '③ ขนาดไม้':'③ Size', 'ห่างจุดสูง':'From high', 'สรุป':'Summary',
  'เข้าได้ตามแผน':'OK per plan', 'ทยอยเข้าเพิ่ม':'Add gradually', 'เข้าได้ ลดขนาดไม้':'OK, smaller size',
  'ไม่ผ่านประตู — หยุดเติมจนกว่าเทรนด์จะกลับ':'Failed gate — pause adding until the trend returns',
  'ไม่เข้า — รอเทรนด์กลับ':'Skip — wait for the trend',
  'ดัชนีอ้างอิง / stablecoin — ไม่นับในสรุป':'Reference index / stablecoin — excluded from summary',
  'อ่านสามคอลัมน์กลางยังไง':'How to read the three middle columns',
  'ทำไมถึงเลิกใช้คะแนนรวม':'Why the combined score was retired', 'กฎเหล็ก':'Iron rule',
  'ข้อจำกัดที่ต้องรู้':'Limitations to know',
  'ตัวเลขทั้งหมดอธิบายสถานะ ณ วันที่ข้อมูลระบุ ไม่ใช่คำแนะนำการลงทุน':'All figures describe the state as of the data date — not investment advice',
  'แยกตามหมวด':'By category', 'กองทุน / ETF':'Funds / ETF', 'หุ้นสหรัฐ':'US stocks', 'หุ้นไทย':'Thai stocks',
  'ทองคำ':'Gold', 'คริปโต':'Crypto',
  'น่าเข้าที่สุดตอนนี้ — ผ่านประตู เรียงตามอันดับ':'Most attractive now — passed gate, ranked',
  'ถืออยู่แล้ว':'Already held', '· ถืออยู่แล้ว':'· already held', 'ป้าย':'Label',
  'กองทุนรวมไทยไม่อยู่ในตารางนี้':'Thai mutual funds are not in this table',
  'ETF ดัชนีที่เป็นตัวแทน':'representative index ETFs',
  'พอร์ตจำลอง — ไม่ใช่เงินจริง':'Simulated portfolio — not real money',
  'บอท (ตามสัญญาณ)':'Bot (follows signals)', 'DCA เฉย ๆ (เส้นวัด)':'Plain DCA (benchmark)',
  'การจับจังหวะได้เปรียบ':'Timing edge', 'เงินที่ใส่ไปทั้งหมด':'Total deposited', 'เงินสดที่บอทถืออยู่':'Bot cash',
  'ตกหนักสุด (drawdown)':'Max drawdown', 'ค่าธรรมเนียมที่จ่ายไป':'Fees paid', 'ผลตอบแทนสะสม':'Cumulative return',
  'อยู่เฉย':'Idle', 'พอร์ตบอท':'Bot portfolio', 'ยังไม่มีสินทรัพย์ในพอร์ตนี้':'No assets in this portfolio yet',
  'DCA เฉย ๆ':'Plain DCA', 'พอร์ต DCA (เส้นวัด)':'DCA portfolio (benchmark)', 'กำไร/ขาดทุน':'P/L', 'น้ำหนัก':'Weight',
  'การเทรดล่าสุดของบอท':'Latest bot trades',
  'ยังไม่มีคำสั่งที่ผ่านเกณฑ์ — การไม่เทรดก็เป็นผลลัพธ์อย่างหนึ่ง':'No qualifying orders yet — not trading is a result too',
  'กฎที่บอทใช้':'Bot rules', 'ทำไมวัดด้วย NAV ต่อหน่วย':'Why measure by NAV per unit',
  'อย่าเพิ่งเชื่อตัวเลขนี้':'Don\'t trust this number yet',
  'วันนี้':'Today', 'ทอง (USD/oz)':'Gold (USD/oz)', 'ภาพรวมจากสัญญาณ macro':'Macro signal overview',
  'ทำไมถึงกลับมาให้คะแนนได้อีก':'Why scoring is back',
  'เดือนนี้ยังไม่มีรายการ':'No activity this month',
  // v67 — การแจ้งเตือน
  'ระบบ':'System', 'การแจ้งเตือน':'Notifications',
  'สรุปพอร์ต · ราคาเคลื่อนไหว · รายงานประจำเดือน · เหตุการณ์ในแอป — เก็บย้อนหลัง 180 วัน':'Portfolio summaries · price moves · monthly reports · in-app events — kept for 180 days',
  'สรุปพอร์ตรายวัน':'Daily portfolio summary', 'ราคาเคลื่อนไหวผิดปกติ':'Unusual price moves', 'สรุปรายสัปดาห์':'Weekly summary',
  'รายงานประจำเดือน':'Monthly report', 'ทดสอบการแจ้งเตือน':'Test notification', 'แจ้งเตือนระบบ':'System notice',
  // v66 — หน้าใหม่
  'ปรับสมดุล':'Rebalance', 'ปรับสมดุลพอร์ต':'Portfolio rebalancing',
  'คำนวณว่าต้องซื้อ/ขายตัวไหนกี่หน่วย ให้สัดส่วนกลับไปตามเป้า — นับทั้งพอร์ตรวม Provident Fund (กองที่ขายไม่ได้แสดงเป็น 🔒 ไม่มีคำสั่งซื้อขาย)':'Works out how many units of each asset to buy or sell to get back to your targets — the whole portfolio counts, including the Provident Fund (funds you cannot sell show as 🔒 with no trade)',
  'วิเคราะห์เจาะลึก':'Deep research',
  'งบการเงินรายปี · ปันผล · ข่าว รายบริษัท — ข้อมูลจาก pipeline (Yahoo · SEC EDGAR) ไม่ใช่คำแนะนำการลงทุน':'Annual financials · dividends · news per company — from the pipeline (Yahoo · SEC EDGAR), not investment advice',
  'ประวัติที่ได้รับจริง':'Dividends actually received',
  'ได้รับแล้ว':'Received', 'ประกาศแล้ว':'Declared', 'ประมาณการ':'Estimated',
  'Dividend Income':'Dividend Income', 'รูดสะสม ≠ ยอดค้าง':'Total charged ≠ balance',
  'ดอกเบี้ยระยะสั้น (T-bill 3M)':'Short-term rate (T-bill 3M)', 'อยู่เหนือ MA200':'Above MA200',
  'ต่ำกว่า MA200':'Below MA200', 'โมเมนตัม 12-1':'Momentum 12-1', 'ทั้งตลาดเหนือ MA200':'Market above MA200',
  'บอทใช้เกณฑ์ 3 ชั้นชุดเดียวกับหน้าสัญญาณ':'The bot uses the same 3-layer rules as the Signals page',
  'เพดานอายุรายสัญญาณ':'Per-signal age limit',
  // ชื่อสินทรัพย์ใน watchlist
  'กสิกรไทย':'Kasikornbank', 'ท่าอากาศยานไทย':'Airports of Thailand', 'ปตท.':'PTT',
  'แอดวานซ์ อินโฟร์':'Advanced Info Service', 'ซีพี ออลล์':'CP ALL', 'กรุงเทพดุสิตเวชการ':'Bangkok Dusit Medical',
  'หุ้นปันผล US (SCHD)':'US dividend stocks (SCHD)', 'US ทั้งตลาด (VTI)':'US total market (VTI)',
  'นอกสหรัฐ (VXUS)':'Ex-US (VXUS)', 'หุ้นไทยทั้งตลาด (THD)':'Thai total market (THD)',
  'ตลาดเกิดใหม่ (VWO)':'Emerging markets (VWO)', 'พันธบัตร US (BND)':'US bonds (BND)',
  'หุ้นเหมืองทอง (GDX)':'Gold miners (GDX)', 'ทองคำ (IAU)':'Gold (IAU)', 'ทองคำ (GLD)':'Gold (GLD)',

  // ── ฟอร์ม / modal / ปุ่ม ────────────────────────────────────────────
  '⚙ เชื่อมต่อ Google Sheets':'⚙ Connect Google Sheets',
  'ค่าจะถูกเก็บในเครื่องนี้':'Values are stored on this device',
  '🔗 คัดลอกลิงก์ตั้งค่า — เปิดบนเครื่องอื่นแล้วตั้งค่าให้เอง':'🔗 Copy setup link — open it on another device to configure it automatically',
  'บันทึก & เชื่อมต่อ':'Save & connect', 'ยกเลิก':'Cancel', 'ปิด':'Close', 'คัดลอกลิงก์':'Copy link',
  'ใช้เป็นแอปได้ — กดปุ่มแชร์':'Use it as an app — tap Share', 'ด้านล่าง แล้วเลือก':'below, then choose',
  '“เพิ่มไปยังหน้าจอโฮม”':'“Add to Home Screen”',
  'เปิดอยู่ในเบราว์เซอร์ของแอปอื่น':'Opened inside another app\'s browser',
  '“เปิดในเบราว์เซอร์”':'“Open in browser”', '(Chrome หรือ Safari)':'(Chrome or Safari)',
  'วันที่':'Date', 'ประเภทรายการ':'Transaction type', 'ราคา/หน่วย':'Price/unit',
  'ค่าธรรมเนียม (บาท)':'Fee (THB)', 'ยอดรวม (บาท)':'Total (THB)', 'ยอดรวม (USD)':'Total (USD)',
  'รายการจะถูกเพิ่มต่อท้ายชีต Asset_Tracker':'The row will be appended to the Asset_Tracker sheet',
  'รายการจะถูกเพิ่มต่อท้ายชีต Transaction':'The row will be appended to the Transaction sheet',
  'ลบรายการ':'Delete', 'บันทึกลงชีต':'Save to sheet', 'รายรับ-รายจ่าย':'Income / expense',
  'ลงชีต Transaction':'to the Transaction sheet', 'รายการลงทุน':'Investment', 'ลงชีต Asset_Tracker':'to the Asset_Tracker sheet',
  '➕ เพิ่มรายการ':'➕ Add entry', 'เพิ่มรายการ':'Add entry', 'หมวด':'Category', 'จำนวนเงิน (บาท)':'Amount (THB)',
  'โอนเข้าบัญชี':'Transfer to account', 'คำนวณให้':'Auto-calculated', 'ไม่บังคับ':'Optional',
  'เช่น CPALL, AAPL, BTC':'e.g. CPALL, AAPL, BTC', 'เช่น Food, Transport':'e.g. Food, Transport',
  'docs.google.com/spreadsheets/d/【ส่วนนี้】/edit':'docs.google.com/spreadsheets/d/【this part】/edit',
};

// ป้ายที่มีตัวเลข/ชื่อแทรก — regex ต้องครอบทั้งข้อความ (^…$)
const N = '([฿$+−\\-]?[\\d.,]+[%kMK]?)';
const RULES = [
  [new RegExp('^ใช้ไป (.+)$'), 'Spent $1'],
  [new RegExp('^ออม (.+)$'), 'Saved $1'],
  [new RegExp('^'+N+' วัน$'), '$1 days'],
  [new RegExp('^'+N+' เดือน$'), '$1 months'],
  [new RegExp('^'+N+' ปี$'), '$1 yrs'],
  [new RegExp('^'+N+' รายการ$'), '$1 items'],
  [new RegExp('^'+N+' บัญชี$'), '$1 accounts'],
  [new RegExp('^'+N+' บัญชี ·$'), '$1 accounts ·'],
  [new RegExp('^'+N+'/ปี$'), '$1/yr'],
  [new RegExp('^'+N+'/เดือน$'), '$1/mo'],
  [new RegExp('^'+N+' เดือนล่าสุด$'), 'Last $1 months'],
  [new RegExp('^⚡ ต้องลงมือ · '+N+' เรื่อง$'), '⚡ Action needed · $1'],
  [new RegExp('^ดูอีก '+N+' เรื่อง ▾$'), 'Show $1 more ▾'],
  [new RegExp('^Savings Rate \\('+N+' เดือน\\)$'), 'Savings Rate ($1 mo)'],
  [new RegExp('^Invest Rate \\('+N+' เดือน\\)$'), 'Invest Rate ($1 mo)'],
  [new RegExp('^เดือนนี้ · (.+)$'), 'This month · $1'],
  [new RegExp('^เป้าหมาย (.+)$'), 'Target $1'],
  [new RegExp('^อันดับ '+N+'$'), 'Rank $1'],
  [new RegExp('^อันดับ '+N+' · ไม้ ×'+N+'$'), 'Rank $1 · size ×$2'],
  [new RegExp('^· ไม้ ×'+N+'$'), '· size ×$1'],
  [new RegExp('^เข้าได้ตามแผน · ไม้ ×'+N+'$'), 'OK per plan · size ×$1'],
  [new RegExp('^ผ่านประตู · อันดับเฉลี่ย '+N+'$'), 'Passed gate · avg rank $1'],
  [new RegExp('^— ผ่านประตู (.+)$'), '— passed gate $1'],
  [new RegExp('^รูดบัตร (.+) · ผ่อน/ใช้หนี้ (.+)$'), 'Card spending $1 · instalments/repayments $2'],
  [new RegExp('^\\(รูด (.+) · จ่าย (.+)\\)$'), '(charged $1 · paid $2)'],
  [new RegExp('^ยังไม่ได้ใส่ดอกเบี้ย '+N+' บัญชี$'), 'Interest not set on $1 accounts'],
  [new RegExp('^งบเกิน '+N+' หมวด · รวมเกิน (.+)$'), '$1 budget categories over · $2 total'],
  [new RegExp('^ครบเป้า '+N+' เดือนแล้ว$'), '$1-month target met'],
  [new RegExp('^ถึงเป้าปลายทาง (.+) แล้ว$'), 'Final goal $1 reached'],
  [new RegExp('^ถึงเป้า (.+) แล้ว!$'), 'Goal $1 reached!'],
  [new RegExp('^ขาดอีก (.+)$'), '$1 to go'],
  [new RegExp('^เหลืออีก (.+)$'), '$1 remaining'],
  [new RegExp('^เหลือ (.+)$'), '$1 left'],
  [new RegExp('^เกิน (.+)$'), 'Over by $1'],
  [new RegExp('^ขาดอีก (.+) · ปลายทาง (.+)$'), '$1 to go · final $2'],
  [new RegExp('^'+N+' เดือน ·$'), '$1 months ·'],
  [new RegExp('^ปันผล '+N+' เดือน ÷ มูลค่าพอร์ตปัจจุบัน$'), '$1-month dividends ÷ current portfolio value'],
  [new RegExp('^'+N+' tx · '+N+' assets · ข้อมูล '+N+' นาทีที่แล้ว$'), '$1 tx · $2 assets · data $3 min ago'],
  [new RegExp('^สินทรัพย์ที่หยุดซื้อเกิน '+N+' วัน — เงินจริงที่ยังจมอยู่แต่หลุดจากเรดาร์$'), 'Assets not bought for over $1 days — real money that fell off the radar'],
  [new RegExp('^'+N+' สินทรัพย์ที่เฝ้าดู — .*$'), '$1 watched assets — stocks · funds/ETF · gold · crypto, scored with the same rules as Signals; the only difference is "not held yet"'],
  [new RegExp('^นักวิเคราะห์ '+N+' คน อ่านข้อมูลชุดเดียวกัน แต่ตอบคนละคำถาม$'), '$1 analysts read the same data but answer different questions'],
  [new RegExp('^ดอกเบี้ยแต่ละใบ · ต้องกรอกเอง .*$'), 'Interest per account · enter manually (not in the sheet) — separate 0% instalments from interest-bearing balances'],
  [new RegExp('^📦 ใช้ข้อมูล cache \\('+N+' นาทีที่แล้ว\\) — กด Sync เพื่ออัปเดต$'), '📦 Using cached data ($1 min ago) — press Sync to update'],
  [new RegExp('^เงินสด (.+) ÷ รายจ่ายจำเป็น (.+)/เดือน$'), 'Cash $1 ÷ essential spending $2/mo'],
  [new RegExp('^เหลือ (.+) · รวมรูดบัตร (.+)$'), '$1 left · incl. card $2'],
  [new RegExp('^เกิน (.+) · รวมรูดบัตร (.+)$'), 'Over by $1 · incl. card $2'],
  [new RegExp('^รวมรูดบัตร (.+)$'), 'incl. card spending $1'],
  [new RegExp('^หนี้ (.+) = (.+) ของสินทรัพย์รวม (.+)$'), 'Debt $1 = $2 of total assets $3'],
  [new RegExp('^(\\S+) '+N+' ของพอร์ต — กระจุกตัว(สูง)?$'), '$1 is $2 of the portfolio — concentrated'],
  [new RegExp('^Saving rate เดือนนี้ '+N+'$'), 'Saving rate this month $1'],
  [new RegExp('^ใช้ราคาล่าสุดที่จำไว้ '+N+' ตัว$'), 'Using last known prices for $1 assets'],
  [new RegExp('^เงินสด (.+) − หนี้ในบัญชี (.+)$'), 'Cash $1 − account debt $2'],
  [new RegExp('^ผ่านแล้ว (.+)$'), 'Passed $1'],
  [new RegExp('^ข้อมูล '+N+' ชม\\.ก่อน ›$'), 'Data $1 h ago ›'],
  [new RegExp('^'+N+' ชม\\.ก่อน$'), '$1 h ago'],
  [new RegExp('^ข้อมูล เมื่อวาน ›$'), 'Data from yesterday ›'],
  [new RegExp('^ข้อมูล ข้อมูล '+N+' วันก่อน ›$'), 'Data $1 days old ›'],
  [new RegExp('^ข้อมูล '+N+' วันก่อน$'), 'Data $1 days old'],
  [new RegExp('^'+N+' เดือน (.+)$'), '$1 months $2'],
  [new RegExp('^Net Worth (.+) · '+N+' ของเป้าปลายทาง$'), 'Net Worth $1 · $2 of the final goal'],
  [new RegExp('^ข้อมูล pipeline: (.+)$'), 'Pipeline data: $1'],
  [new RegExp('^เงินสด '+N+' เดือนล่าสุด: (.+)$'), 'Cash, last $1 months: $2'],
  [new RegExp('^เงินสด (.+) · '+N+'$'), 'Cash $1 · $2'],
  [new RegExp('^พอร์ต (.+) · '+N+'$'), 'Portfolio $1 · $2'],
  [new RegExp('^ประกัน CV (.+) · '+N+'$'), 'Insurance CV $1 · $2'],
  [new RegExp('^ค่าธรรมเนียมฝั่งซื้อ (.+)$'), 'Buy-side fees $1'],
  [new RegExp('^(.+) /ปี$'), '$1 /yr'],
  [new RegExp('^หลังเงินเฟ้อไทย (.+) →$'), 'After Thai inflation $1 →'],
  [new RegExp('^ตั้งแต่ (.+) · (.+) ปี · '+N+' cashflows$'), 'Since $1 · $2 yrs · $3 cashflows'],
  [new RegExp('^เงินตัวเองสุทธิ (.+) · ตลาดสร้างให้$'), 'Your net money $1 · the market added'],
  [new RegExp('^'+N+' กรมธรรม์$'), '$1 policies'],
  [new RegExp('^จากทั้งหมด '+N+' · คลิกแสดง/ซ่อนรายการ$'), 'of $1 total · click to show/hide'],
  [new RegExp('^(.+) · เหลือ '+N+' วัน$'), '$1 · $2 days left'],
  [new RegExp('^'+N+' บัญชี · '+N+' ของเงินสด$'), '$1 accounts · $2 of cash'],
  [new RegExp('^· '+N+' รายการ ตั้งแต่ (.+)$'), '· $1 entries since $2'],
  [new RegExp('^'+N+' รก\\.$'), '$1 tx'],
  [new RegExp('^เดือนนี้หนี้เพิ่ม (.+)$'), 'Debt up $1 this month'],
  [new RegExp('^เดือนนี้หนี้ลดลง (.+)$'), 'Debt down $1 this month'],
  [new RegExp('^เดือนนี้ยอดไม่เปลี่ยน (.+)$'), 'No net change this month $1'],
  [new RegExp('^ใส่ดอกเบี้ยต่อปี เช่น '+N+'$'), 'Annual interest, e.g. $1'],
  [new RegExp('^ลงทุนจริง (.+) · เฉลี่ย (.+)/เดือน$'), 'Actually invested $1 · avg $2/mo'],
  [new RegExp('^'+N+' เดือน · รายจ่ายเฉลี่ย (.+)$'), '$1 months · avg expenses $2'],
  [new RegExp('^'+N+' รายการ · ตั้งแต่ (.+)$'), '$1 payments · since $2'],
  [new RegExp('^เฉลี่ย (.+)/เดือน · '+N+' รายการ$'), 'avg $1/mo · $2 payments'],
  [new RegExp('^ปันผล (.+)/เดือน vs รายจ่าย (.+)/เดือน$'), 'Dividends $1/mo vs expenses $2/mo'],
  [new RegExp('^'+N+' รายการ · '+N+' ของทุนทั้งหมด$'), '$1 items · $2 of total capital'],
  [new RegExp('^'+N+' รายการ · (.+)$'), '$1 items · $2'],
  [new RegExp('^'+N+' ครั้ง$'), '$1 times'],
  [new RegExp('^ทุก ~(\\S+) · สม่ำเสมอ$'), 'every ~$1 · regular'],
  [new RegExp('^ทุก ~(\\S+) · ไม่สม่ำเสมอ$'), 'every ~$1 · irregular'],
  [new RegExp('^'+N+' ของมูลค่าซื้อขาย \\(ซื้อ\\+ขาย\\)$'), '$1 of traded value (buy+sell)'],
  [new RegExp('^(.+) จาก (.+)$'), '$1 of $2'],
  [new RegExp('^'+N+' สัญญาณ · ตัดของเก่า '+N+'$'), '$1 signals · $2 stale dropped'],
  [new RegExp('^ข้อมูลเก่าสุด (.+)$'), 'Oldest data $1'],
  [new RegExp('^ดูสัญญาณทั้ง '+N+' ตัว$'), 'View all $1 signals'],
  [new RegExp('^· '+N+' วันก่อน$'), '· $1 days ago'],
  [new RegExp('^เหนือ MA200 · โมเมนตัม 12-1 เดือน (.+)$'), 'Above MA200 · 12-1 mo momentum $1'],
  [new RegExp('^ต่ำกว่า MA200 · โมเมนตัม 12-1 เดือน (.+)$'), 'Below MA200 · 12-1 mo momentum $1'],
  [new RegExp('^โมเมนตัม 12-1 เดือน (.+)$'), '12-1 mo momentum $1'],
  [new RegExp('^(.+) · ดัชนีอ้างอิง$'), '$1 · reference index'],
  [new RegExp('^จาก '+N+' ตัวที่ข้อมูลยังสด$'), 'of $1 with fresh data'],
  [new RegExp('^(.+) · ถืออยู่แล้ว$'), (m,a)=>(translate(a)||a)+' · already held'],
  [new RegExp('^มูลค่า (.+)$'), 'Value $1'],
  [new RegExp('^เดินมาแค่ '+N+' วัน — ยังสรุปอะไรไม่ได้$'), 'Only $1 day(s) in — too early to conclude'],
  [new RegExp('^เท่ากันทั้งสองพอร์ต · เดินมา '+N+' วัน$'), 'Both portfolios equal · $1 day(s) in'],
  [new RegExp('^(.+) · เงินที่รอจังหวะ ไม่ใช่เงินที่ลืม$'), '$1 · cash waiting for an entry, not forgotten'],
  [new RegExp('^DCA (.+) — ตัวเลขที่บอกว่าทนได้ไหม$'), 'DCA $1 — tells you whether you could stomach it'],
  [new RegExp('^'+N+' คำสั่ง — ต้นทุนของการขยับบ่อย$'), '$1 orders — the cost of trading often'],
  [new RegExp('^บอทคิดอะไรในรอบล่าสุด \\((.+)\\)$'), 'What the bot decided last run ($1)'],
  [new RegExp('^· กฎ (.+)$'), '· rules $1'],
  [new RegExp('^ยังไม่ถึง (.+)$'), 'Not yet $1'],
];

let lang = 'th';
try { lang = localStorage.getItem('finOS_lang') === 'en' ? 'en' : 'th'; } catch(e){}
const TH = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;   // อักษรไทย — ไม่รวม ฿ (U+0E3F) ไม่งั้น "Spent ฿5,500" ถูกมองว่ายังมีไทยค้าง
const ATTRS = ['title','placeholder','aria-label'];
const origText = new WeakMap();   // text node → ข้อความไทยต้นฉบับ
const origAttr = new WeakMap();   // element → {attr: ต้นฉบับ}

function translate(s){
  const k = String(s).replace(/\s+/g,' ').trim();
  if(!k || !TH.test(k)) return null;
  if(Object.prototype.hasOwnProperty.call(DICT,k)) return DICT[k];
  for(const [re,rep] of RULES) if(re.test(k)){
    const out = k.replace(re,rep);
    if(!TH.test(out)) return out;   // ส่วนที่แทรกยังเป็นไทย → ไม่แปลครึ่ง ๆ กลาง ๆ ลองกฎถัดไป
  }
  return null;
}
const skip = el => !el || el.closest('script,style,textarea,[data-no-i18n]');

function doText(n){
  if(lang === 'en'){
    const cur = n.nodeValue;
    if(!cur || !TH.test(cur) || skip(n.parentElement)) return;
    const t = translate(cur); if(t == null) return;
    const lead = cur.match(/^\s*/)[0], trail = cur.match(/\s*$/)[0];
    origText.set(n, cur); n.nodeValue = lead + t + trail;
  } else if(origText.has(n)){
    n.nodeValue = origText.get(n); origText.delete(n);
  }
}
function doAttrs(el){
  if(skip(el)) return;
  for(const a of ATTRS){
    if(!el.hasAttribute(a)) continue;
    const saved = origAttr.get(el) || {};
    if(lang === 'en'){
      const v = el.getAttribute(a); if(!TH.test(v)) continue;
      const t = translate(v); if(t == null) continue;
      saved[a] = v; origAttr.set(el, saved); el.setAttribute(a, t);
    } else if(saved[a] != null){
      el.setAttribute(a, saved[a]); delete saved[a];
    }
  }
}
function walk(root){
  if(!root) return;
  if(root.nodeType === 3){ doText(root); return; }
  if(root.nodeType !== 1) return;
  doAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n; while((n = w.nextNode())){ if(n.nodeType === 3) doText(n); else doAttrs(n); }
}

// หน้า render ใหม่ด้วย innerHTML ตลอด → แปลเฉพาะ node ที่เพิ่งเพิ่ม (ไม่ฟัง characterData กันวนลูป)
let pending = new Set(), scheduled = false;
const mo = new MutationObserver(list => {
  if(lang !== 'en') return;
  for(const m of list){
    if(m.type === 'childList') m.addedNodes.forEach(x => pending.add(x));
    else if(m.type === 'attributes') pending.add(m.target);
  }
  if(!scheduled){ scheduled = true; queueMicrotask(flush); }
});
function flush(){
  scheduled = false;
  const nodes = [...pending]; pending = new Set();
  nodes.forEach(n => { if(n.isConnected) walk(n); });
}

function applyDocLang(){
  document.documentElement.lang = lang;
  document.documentElement.setAttribute('data-lang', lang);
}
function setLang(l){
  lang = l === 'en' ? 'en' : 'th';
  try { localStorage.setItem('finOS_lang', lang); } catch(e){}
  window.LOC = lang === 'en' ? 'en-US' : 'th-TH-u-ca-gregory';
  applyDocLang();
  walk(document.body);
  document.querySelectorAll('[data-lang-btn]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-lang-btn') === lang));
  if(typeof window.onLangChange === 'function') try { window.onLangChange(lang); } catch(e){ console.warn('[i18n]', e); }
}

// ภาษาอังกฤษ → วันที่/เดือนแบบ en-US · ต้องตั้งก่อน shared.js อ่าน LOC
if(lang === 'en') window.LOC = 'en-US';
applyDocLang();
function start(){
  mo.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:ATTRS });
  if(lang === 'en') walk(document.body);
  document.querySelectorAll('[data-lang-btn]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-lang-btn') === lang));
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

window.I18N = { t: s => (lang === 'en' ? (translate(s) ?? s) : s), setLang, get lang(){ return lang; },
                translate, DICT, RULES };
})();
