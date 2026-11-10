/* v87 — ฟอร์มแถวชีตทั่วไป (Asset_Live_Price_Feed · Insurance_Policies · Insurance_Coverage) + จดยอดจริงหลายบัญชี (Reconcile)
 *
 *   node tests/test_sheet_forms.cjs js/shared.js
 *
 * กรณีสำคัญ: ห้ามเขียนทับคอลัมน์สูตร · เลขกรมธรรม์ 0 นำหน้าต้องไม่หาย · ข้อความขึ้นต้น = ต้องไม่กลายเป็นสูตร ·
 * บัตรเครดิตกรอกยอดค้างเป็นบวกแล้วเก็บติดลบ (ชีตเก็บหนี้เป็นค่าลบ — ตรงกับยอดในแอป)
 */
const fs = require('fs');
const store = {};
global.window = {};
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
eval(fs.readFileSync(process.argv[2] || 'js/shared.js', 'utf8'));

let FAIL = 0;
const chk = (name, cond, detail) => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  ' + JSON.stringify(detail)}`); if (!cond) FAIL++; };

console.log('\n═══ ชนิดช่องจากหัวคอลัมน์ ═══');
{
  const t = n => srfFieldType(n);
  chk('วันที่: Renewal_Date · Policy_Date · Maturity_Date', ['Renewal_Date', 'Policy_Date', 'Maturity_Date'].every(n => t(n) === 'date'));
  chk('ตัวเลข: Annual_Premium · Surrender_Value · Coverage_Amount · Target_Amount · Current_Price_THB',
    ['Annual_Premium', 'Surrender_Value', 'Coverage_Amount', 'Target_Amount', 'Current_Price_THB'].every(n => t(n) === 'number'));
  chk('ข้อความ: Policy_ID · Coverage_Type · Unit · Benefit_Name · Ticker · Active · Plan_Name',
    ['Policy_ID', 'Coverage_Type', 'Unit', 'Benefit_Name', 'Ticker', 'Active', 'Plan_Name', 'Notes'].every(n => t(n) === 'text'));
}

console.log('\n═══ คอลัมน์สูตรไม่ให้กรอก (หัวตาราง + atFormulaKinds) ═══');
{
  // หน้าตาแบบ Asset_Live_Price_Feed: A Ticker · B ราคา (สูตรรายแถว GOOGLEFINANCE) · C Active · D Industry (ARRAYFORMULA) · E (ไม่มีหัว)
  const header = ['Ticker', 'Current_Price_THB', 'Active', 'Industry', ''];
  const kinds = atFormulaKinds(['AAPL', '=GOOGLEFINANCE(A2)*FX', 'Active', '=ARRAYFORMULA(IF(A2:A="","",XLOOKUP(A2:A,Map!A:A,Map!B:B)))'],
                               ['KBANK', '=GOOGLEFINANCE(A40)', 'Active', 'Banking']);
  const f = srfColumns(header, kinds);
  const by = n => f.find(x => x.name === n);
  chk('ข้ามคอลัมน์ที่ไม่มีหัว', f.length === 4, f);
  chk('ราคา = สูตรรายแถว (คัดลอกลงแถวใหม่)', by('Current_Price_THB').formula === 'row', by('Current_Price_THB'));
  chk('Industry = ARRAYFORMULA (ห้ามเขียน)', by('Industry').formula === 'spill', by('Industry'));
  chk('Ticker / Active = ช่องกรอก', by('Ticker').formula === null && by('Active').formula === null);
}

console.log('\n═══ ค่าที่ส่งให้ Sheets ═══');
{
  const w = (t, v) => srfWriteValue(t, v);
  chk('ตัวเลขมีจุลภาค/฿ → number', w('number', '฿12,500.50').v === 12500.5);
  chk('ตัวเลขผิด → error', w('number', '12x').ok === false);
  chk('ช่องว่าง → ""', w('number', '  ').v === '' && w('text', '').v === '');
  chk('วันที่ ISO คงเดิม', w('date', '2026-11-10').v === '2026-11-10');
  chk('วันที่ 10/11/2026 (วัน/เดือน/ปี) → 2026-11-10', w('date', '10/11/2026').v === '2026-11-10', w('date', '10/11/2026'));
  chk('วันที่ผิด → error', w('date', 'พรุ่งนี้').ok === false);
  chk('เลขกรมธรรม์ 0 นำหน้า → ใส่ \' (ไม่ให้ Sheets ตัด 0)', w('text', '0012345').v === "'0012345");
  chk('ข้อความขึ้นต้น = → ใส่ \' (ไม่ให้กลายเป็นสูตร)', w('text', '=IMPORTXML("x")').v === "'=IMPORTXML(\"x\")");
  chk('ข้อความธรรมดาคงเดิม', w('text', 'Muang Thai Life').v === 'Muang Thai Life' && w('text', 'BRK-B').v === 'BRK-B');
  chk('ค่าในชีต (serial date) → ช่อง date', srfCellValue('date', 46336) === '2026-11-10', srfCellValue('date', 46336));
}

console.log('\n═══ หาแถว ═══');
{
  const V = [['Insurance Policies'], ['Status', 'Policy_ID', 'Plan_Name'],
    ['In-Force', 'P-001', 'Health'], ['Lapsed', 'p-002', 'Life'], [], ['', '', 'stray note']];
  chk('แถวข้อมูลสุดท้ายนับจากคอลัมน์กุญแจ (ไม่นับแถวที่มีแค่โน้ต)', srfLastDataRow(V, 1, [1]) === 3, srfLastDataRow(V, 1, [1]));
  chk('ไม่มีข้อมูล → แถวหัวตาราง', srfLastDataRow([['h']], 0, [0]) === 0);
  chk('หาแถวด้วยกุญแจ (ไม่สนตัวพิมพ์/ช่องว่าง)', srfFindRow(V, 1, V[1], { Policy_ID: ' P-002 ' }) === 3);
  chk('หลายกุญแจต้องตรงทุกช่อง', srfFindRow(V, 1, V[1], { Policy_ID: 'P-001', Plan_Name: 'Life' }) === -1);
  const C = [[''], ['Policy_ID', 'Coverage_Type', 'Benefit_Name'], ['P-001', 'OPD', ''], ['P-001', 'OPD', 'Dental']];
  chk('ความคุ้มครองชื่อผลประโยชน์ว่างหาเจอ', srfFindRow(C, 1, C[1], { Policy_ID: 'P-001', Coverage_Type: 'OPD', Benefit_Name: '' }) === 2);
  chk('หัวที่ไม่มีในแท็บไม่นับ (ไม่ match ทุกแถว)', srfFindRow(C, 1, C[1], { Nope: 'x' }) === -1);
}

console.log('\n═══ จดยอดจริงหลายบัญชี (Reconcile) ═══');
{
  const acc = [{ name: 'SCB Bank', liab: false }, { name: 'SCB Up2ME', liab: true }, { name: 'KBank Line Point', liab: true }, { name: 'Rabbit Card', liab: false }];
  const p = reconPlanRows(acc, { 'SCB Bank': '15,734.53', 'SCB Up2ME': '23,323', 'KBank Line Point': '-50', 'Rabbit Card': '' });
  chk('ข้ามบัญชีที่ไม่ได้กรอก', p.rows.length === 3, p);
  chk('บัญชีธนาคาร = ค่าที่กรอก', p.rows[0].actual === 15734.53, p.rows[0]);
  chk('บัตรเครดิตกรอกยอดค้าง 23,323 → เก็บ −23,323', p.rows[1].actual === -23323, p.rows[1]);
  chk('บัตรจ่ายเกิน (กรอก −50) → เก็บ +50', p.rows[2].actual === 50, p.rows[2]);
  chk('บัตรยอด 0 → เก็บ 0 (ไม่ใช่ −0)', Object.is(reconPlanRows(acc, { 'SCB Up2ME': '0' }).rows[0].actual, 0));
  const bad = reconPlanRows(acc, { 'SCB Bank': 'abc' });
  chk('ตัวเลขผิด → errors', bad.errors.length === 1 && !bad.rows.length, bad);
  // ค่าที่เก็บต้องอ่านกลับด้วย parseReconcileRows แล้วได้ยอดเดิม
  const H = ['Date', 'Account', 'Actual_Balance', 'Note'];
  const rows = [H].concat(p.rows.map(r => reconRowValues(H, '2026-11-10', r.account, r.actual, 'จดต้นสัปดาห์')));
  const m = parseReconcileRows(rows);
  chk('parseReconcileRows อ่านกลับได้ยอดเดิม', m['SCB Up2ME'].actual === -23323 && m['SCB Bank'].date === '2026-11-10' && m['SCB Bank'].note === 'จดต้นสัปดาห์', m);
  const H2 = ['Account', 'Note', 'Actual_Balance', 'Date'];
  chk('เรียงตามหัวตารางจริงของชีต (คอลัมน์สลับ)', JSON.stringify(reconRowValues(H2, '2026-11-10', 'SCB Bank', 1, '')) === JSON.stringify(['SCB Bank', '', 1, '2026-11-10']));
  chk('ไม่มีคอลัมน์ Actual_Balance → null', reconRowValues(['Date', 'Account'], 'd', 'a', 1, '') === null);
}

console.log(FAIL ? `\n❌ ไม่ผ่าน ${FAIL} ข้อ` : '\n✅ ผ่านทั้งหมด');
if (FAIL) process.exit(1);
