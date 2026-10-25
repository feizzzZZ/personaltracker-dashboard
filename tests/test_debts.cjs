/* ชุดทดสอบหนี้สิน — แท็บ Debts (v77)
   รัน:  node tests/test_debts.cjs shared.js
   ข้อมูลทดสอบหลักคือแถวจริงจากชีต (ผ่อนมอเตอร์ไซต์ เม.ย. 2025 – ก.ย. 2026): ค่างวดช่วงแรกไม่เท่ากัน
   (3,000 / 3,500 / 3,248 / จ่ายสองงวดในเดือนเดียว) แต่ยอดรวม = 18 × 3,472 พอดี                     */
const fs = require('fs');
const FILE = process.argv[2] || 'js/shared.js';
let FAIL = 0;
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { FAIL++; console.log('  ✗ ' + n + '  ' + d); } };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = {};
global.document = { getElementById: () => null, querySelector: () => null };
const api = new Function(fs.readFileSync(FILE, 'utf8') +
  '; return {parseDebtRows,debtRowValues,debtTypeOf,debtProgress,debtOverview,debtSchedule,debtDueDate,DEBT_HEADER};')();
const { parseDebtRows, debtRowValues, debtTypeOf, debtProgress, debtOverview, debtSchedule, debtDueDate, DEBT_HEADER } = api;

const tx = (date, type, category, details, acct) => ({dateStr: date, type, category, details, acct,
  amount: Object.values(acct).reduce((s, v) => s + v, 0)});
const K = 'Krungsri Bank';
const moto = [
  tx('2025-04-04','Debt','Motocycle','ค่าดาวน์รถ',{[K]:-30000}),
  tx('2025-04-22','Debt','Motocycle','จ่ายค่างวดรถมอเตอร์ไซต์',{[K]:-5000}),
  tx('2025-05-10','Expense','Motocycle','เช็คระยะรถ',{'Kasikorn Bank':-325}),   // ค่าซ่อม — ไม่ใช่ค่างวด
  ...[['2025-05-27',3000],['2025-06-28',3000],['2025-07-26',3500],['2025-08-28',3000],['2025-09-27',3500],
      ['2025-10-27',3500],['2025-11-27',3500],['2025-12-28',3248],['2026-01-27',3500],['2026-03-01',3444],
      ['2026-03-28',3472],['2026-04-28',3472],['2026-05-28',3472],['2026-06-27',3472],['2026-07-27',3472],
      ['2026-08-29',3472],['2026-09-26',3472]].map(([d,a]) => tx(d,'Debt','Motocycle','จ่ายค่างวดรถมอเตอร์ไซต์',{[K]:-a})),
  tx('2026-10-10','Expense','Motocycle','เช็คระยะรถ',{'SCB Bank':-840}),
];
const mom = ['2026-07-27','2026-08-28','2026-09-26'].map(d => tx(d,'Debt','Loan Debt (Mom)','Mom - Debt',{'SCB Bank':-4500}));
const card = [
  tx('2026-08-05','Debt','SCB Up2ME Credit Card','ดอกเบี้ยบัตรเครดิต',{'SCB Up2ME Credit Card':-249.19}),
  tx('2026-08-06','Debt','Clear Debt SCB Up2ME Credit Card','SCB Up2ME Credit Card',{'SCB Bank':-7661.47,'SCB Up2ME Credit Card':7661.47}),
  tx('2026-09-05','Debt','SCB Up2ME Credit Card','ดอกเบี้ยบัตรเครดิต',{'SCB Up2ME Credit Card':-249.19}),
  tx('2026-09-06','Debt','Clear Debt SCB Up2ME Credit Card','SCB Up2ME Credit Card',{'SCB Bank':-9047.03,'SCB Up2ME Credit Card':9047.03}),
  tx('2026-10-06','Debt','Clear Debt SCB Up2ME Credit Card','SCB Up2ME Credit Card',{'SCB Bank':-7480.81,'SCB Up2ME Credit Card':7480.81}),
];
const income = ['2026-07-25','2026-08-25','2026-09-25','2026-10-25'].map(d => tx(d,'Income','Salary Income','Salary',{'SCB Bank':40000}));
const TX = [...moto, ...mom, ...card, ...income];

// แถวชีตเหมือนที่สร้างจริง (วันที่เป็น serial จาก UNFORMATTED_VALUE)
const sheet = [DEBT_HEADER,
  ['ผ่อนมอเตอร์ไซต์','Installment','','Motocycle','Krungsri Bank','',45769,3472,24,0,'',30000,'','Flat',27,'','Active','ดาวน์'],
  ['ช่วยแม่จ่ายหนี้','Family Support','แม่','Loan Debt (Mom)','SCB Bank','',45232,4500,'',0,'','','','',27,'','Active',''],
  ['SCB Up2ME Credit Card','Credit Card','SCB','Clear Debt SCB Up2ME Credit Card','SCB Bank','SCB Up2ME Credit Card','','','','','','','','',6,'','Active',''],
  ['KBank Line Point','Credit Card','KBank','Clear Debt KBank Line Point','Kasikorn Bank','KBank Line Point','','','','','','','','',19,'','Active',''],
  ['', 'Other'],                                        // แถวว่าง — ข้าม
  ['รถเก่า','Installment','','Car','','','2020-01-01','5,000','12','','','','','','','','Closed',''],
];

console.log('อ่านแท็บ Debts');
const {debts, meta} = parseDebtRows(sheet);
chk('อ่านได้ 5 ก้อน (ข้ามแถวว่าง)', debts.length === 5, debts.length);
chk('วันที่ serial → ISO', debts[0].first === '2025-04-22', debts[0].first);
chk('ตัวเลขมีคอมมา', debts[4].inst === 5000 && debts[4].term === 12);
chk('Status Closed', debts[4].status === 'Closed' && debts[0].status === 'Active');
chk('แถวจริงในชีต', debts[0].row === 2 && debts[4].row === 7);
chk('ประเภทภาษาไทย', debtTypeOf('บัตรเครดิต') === 'Credit Card' && debtTypeOf('ผ่อนบนบัตร') === 'Card Installment' && debtTypeOf('ช่วยครอบครัว') === 'Family Support');
const hdrTh = parseDebtRows([['ชื่อหนี้','ประเภท','ค่างวด','จำนวนงวด'],['ผ่อนมือถือ','ผ่อนสินค้า/รถ','1,000','10']]);
chk('หัวตารางภาษาไทยก็อ่านได้', hdrTh.debts.length === 1 && hdrTh.debts[0].inst === 1000 && hdrTh.debts[0].type === 'Installment');
chk('ไม่มีหัวตาราง → ว่าง', parseDebtRows([['a','b'],['c','d']]).meta === null);
const rv = debtRowValues(meta, {name:'x', type:'Loan', inst:100, status:'Active'});
chk('เขียนกลับตามตำแหน่งคอลัมน์', rv.length === 18 && rv[0] === 'x' && rv[1] === 'Loan' && rv[7] === 100 && rv[16] === 'Active');
chk('ช่องที่ไม่ได้ส่งมา (ฟอร์มซ่อน) = null ไม่ล้างค่าในชีต', rv[5] === null && rv[15] === null);
chk('ช่องว่างที่ตั้งใจ = ""', debtRowValues(meta, {name:'x', note:''})[17] === '');

console.log('ผ่อนมอเตอร์ไซต์ (ข้อมูลจริง)');
const opts = {today: '2026-10-24', balances: {'SCB Up2ME Credit Card': -23323.11, 'KBank Line Point': -236}};
const m = debtProgress(debts[0], TX, opts);
chk('ไม่นับเงินดาวน์ / ค่าเช็คระยะ (แถว Expense)', m.payments === 18, m.payments);
chk('ยอดจ่ายรวม 62,496', Math.abs(m.paidTotal - 62496) < 0.01, m.paidTotal);
chk('จ่ายแล้ว 18 / 24 งวด', m.paidInst === 18 && m.left === 6, m.paidInst + '/' + m.left);
chk('คงเหลือ 20,832', m.remaining === 20832, m.remaining);
chk('งวดถัดไป ต.ค. 2026 (ยังไม่จ่าย)', m.nextYm === '2026-10', m.nextYm);
chk('งวดสุดท้าย มี.ค. 2027', m.endYm === '2027-03', m.endYm);
chk('สถานะเดือนนี้ = ยังไม่ถึงกำหนด (27)', m.due && m.due.status === 'due' && m.due.dueDate === '2026-10-27', JSON.stringify(m.due));
const late = debtProgress(debts[0], TX, {...opts, today: '2026-10-29'});
chk('เลยวันที่ 27 แล้วยังไม่จ่าย → late', late.due.status === 'late');
const paidOct = debtProgress(debts[0], [...TX, tx('2026-10-27','Debt','Motocycle','งวด',{[K]:-3472})], opts);
chk('จ่ายงวด ต.ค. แล้ว → 19/24 · งวดถัดไป พ.ย.', paidOct.paidInst === 19 && paidOct.nextYm === '2026-11' && paidOct.endYm === '2027-03' && paidOct.due.status === 'paid');
const before = debtProgress({...debts[0], paidBefore: 2}, TX, opts);
chk('Paid Before บวกเพิ่ม', before.paidInst === 20 && before.left === 4);
const over = debtProgress({...debts[0], term: 10}, TX, opts);
chk('จ่ายครบแล้ว → left 0 ไม่ติดลบ', over.left === 0 && over.remaining === 0 && over.monthly === 0);
const withP = debtProgress({...debts[0], principal: 70000}, TX, opts);
chk('มียอดจัด → ดอกเบี้ยรวม = ค่างวดรวม − ยอดจัด', withP.totalInterest === 24 * 3472 - 70000);

console.log('ช่วยแม่จ่ายหนี้');
const mm = debtProgress(debts[1], TX, opts);
chk('ภาระต่อเนื่อง 4,500/เดือน', mm.kind === 'ongoing' && mm.monthly === 4500 && !mm.own);
chk('ต.ค. ยังไม่จ่าย', mm.due.status === 'due' && mm.due.paidAmt === 0);

console.log('บัตรเครดิต');
const c = debtProgress({...debts[2], limit: 50000, rate: 16}, TX, opts);
chk('ยอดค้างจาก balances', Math.abs(c.balance - 23323.11) < 0.01);
chk('ใช้วงเงิน 46.6%', Math.abs(c.util - 23323.11 / 50000) < 1e-9);
chk('นับยอดจ่ายจากบัญชีธนาคาร (ยอดสุทธิแถวเป็น 0)', Math.abs(c.paidThisMonth - 7480.81) < 0.01, c.paidThisMonth);
chk('จ่ายบัตรเดือนนี้แล้ว → paid', c.due.status === 'paid');
chk('ดอกเบี้ยที่ถูกเก็บจริง 2 ครั้ง', c.interest.length === 2 && Math.abs(c.interestSum - 498.38) < 0.01);
chk('ภาระต่อเดือนของบัตร = ขั้นต่ำ 10% (ไม่ใช่ยอดจ่ายจริง)', Math.abs(c.monthly - 2332.311) < 0.01 && Math.abs(c.typical - 7661.47) < 0.01, c.monthly + ' / ' + c.typical);
chk('ขั้นต่ำไม่ต่ำกว่า ฿500 และไม่เกินยอดค้าง', debtProgress(debts[3], TX, opts).minPay === 236
  && debtProgress(debts[3], TX, {...opts, balances:{'KBank Line Point':-2000}}).minPay === 500);
chk('ดอกเบี้ย/เดือนโดยประมาณ', Math.abs(c.monthlyInterest - 23323.11 * 0.16 / 12) < 0.01);
const c2 = debtProgress(debts[2], TX, {...opts, aprFallback: {'SCB Up2ME Credit Card': 18}});
chk('ไม่มี Rate ในชีต → ใช้ค่าที่เคยกรอกในเครื่อง', c2.rate === 18);
const cfree = debtProgress({...debts[2], rate: 16}, TX, {...opts, cardFree: {'SCB Up2ME Credit Card': 20000}});
chk('ยอดผ่อน 0% หักออกจากยอดคิดดอก', Math.abs(cfree.intBal - 3323.11) < 0.01);

const shared = [
  tx('2026-10-03','Debt','Credit card payment','จ่ายบัตร KTC',{'SCB Bank':-3000,'KTC':3000}),
  tx('2026-10-04','Debt','Credit card payment','จ่ายบัตร UOB',{'SCB Bank':-5000,'UOB':5000}),
];
const ktc = debtProgress({name:'KTC', type:'Credit Card', payCat:'Credit card payment', card:'KTC', status:'Active'}, shared, {...opts, balances:{KTC:-1000}});
chk('สองบัตรใช้หมวดจ่ายเดียวกัน → นับเฉพาะแถวที่ตัดยอดบัตรใบนั้น', ktc.paidThisMonth === 3000, ktc.paidThisMonth);
const loan = debtProgress({name:'Car', type:'Loan', payCat:'Car loan', card:'Car Loan', first:'2026-01-01', inst:8900, term:48, paidBefore:12, status:'Active'},
  [tx('2026-09-05','Debt','Car loan','ค่างวดรถ',{'SCB Bank':-8900,'Car Loan':8900}), tx('2026-10-05','Debt','Car loan','ค่างวดรถ',{'SCB Bank':-8900,'Car Loan':8900})], opts);
chk('สินเชื่อที่มีคอลัมน์ของตัวเอง: นับเงินออกจากธนาคาร', loan.paidInst === 14 && loan.left === 34 && loan.due.status === 'paid', loan.paidInst);
const loanB = debtProgress({name:'Car', type:'Loan', payCat:'Car loan', card:'Car Loan', inst:8900, term:48, status:'Active'}, [], {...opts, balances:{'Car Loan':-186500}});
chk('ยอดหนี้ของสินเชื่อ = ยอดในคอลัมน์ (เงินต้น) ไม่ใช่งวดที่เหลือ × ค่างวด', loanB.owed === 186500 && loanB.remaining === 48 * 8900);

console.log('ผ่อนบนบัตร (ไม่มีหมวดจับคู่ → ประมาณจากตารางเวลา)');
const ci = {name:'AIA ผ่อน 0%', type:'Card Installment', card:'SCB Up2ME Credit Card', payCat:'', first:'2026-08-06', inst:5000, term:6, paidBefore:0, dueDay:6, status:'Active'};
const cip = debtProgress(ci, TX, opts);
chk('ส.ค. ก.ย. ต.ค. ถึงกำหนดแล้ว → 3/6', cip.paidInst === 3 && cip.left === 3 && cip.estimated, cip.paidInst);
chk('ผ่อนบนบัตรไม่เอายอดทั้งใบมาเป็นเงินต้น', cip.acctBalance === null && cip.owed === 0 && cip.remaining === 15000);
const ov = debtOverview([...debts, ci], TX, opts);
const sc = ov.items.find(i => i.name === 'SCB Up2ME Credit Card');
chk('ยอดผ่อนบนบัตรที่เหลือ = ยอดปลอดดอกของบัตร', sc.free === 15000, sc.free);

console.log('ภาพรวม');
chk('ไม่นับก้อนที่ Closed', !ov.items.some(i => i.name === 'รถเก่า'));
chk('หนี้รวม = มอเตอร์ไซต์ + บัตรสองใบ (ไม่นับผ่อนบนบัตรซ้ำ · ไม่นับช่วยแม่)',
  Math.abs(ov.totalOwed - (20832 + 23323.11 + 236)) < 0.01, ov.totalOwed);
chk('ภาระช่วยครอบครัวแยกออกมา', ov.monthlySupport === 4500);
chk('รายได้เฉลี่ย 3 เดือนเต็ม (ไม่นับ ต.ค.)', ov.income === 40000, ov.income);
chk('ปลอดหนี้ผ่อน มี.ค. 2027', ov.debtFreeYm === '2027-03', ov.debtFreeYm);
chk('รายการครบกำหนดเรียงตามวันที่', ov.due.map(x => x.dueDate).join() === [...ov.due.map(x => x.dueDate)].sort().join());

console.log('ตารางภาระล่วงหน้า');
const s = debtSchedule(ov.items, '2026-10', 8);
chk('ต.ค. 2026 มีค่างวดรถ + ช่วยแม่', s.rows[0].parts['ผ่อนมอเตอร์ไซต์'] === 3472 && s.rows[0].parts['ช่วยแม่จ่ายหนี้'] === 4500);
chk('มี.ค. 2027 ยังมีค่างวด · เม.ย. 2027 ไม่มีแล้ว', s.rows[5].parts['ผ่อนมอเตอร์ไซต์'] === 3472 && !s.rows[6].parts['ผ่อนมอเตอร์ไซต์']);
chk('เหตุการณ์: เม.ย. 2027 มีเงินเหลือเพิ่ม 3,472', s.events.some(e => e.ym === '2027-04' && e.freed === 3472 && e.name === 'ผ่อนมอเตอร์ไซต์'));
chk('วันครบกำหนด 31 ในเดือนสั้น', debtDueDate('2027-02', 31) === '2027-02-28' && debtDueDate('2026-10', 27) === '2026-10-27');

console.log(FAIL ? `\n❌ ไม่ผ่าน ${FAIL} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(FAIL ? 1 : 0);
