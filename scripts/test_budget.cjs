/* ทดสอบ budgetSpendMap() ใน shared.js (v63) — งบนับรายจ่ายที่รูดบัตร
 *
 *   node scripts/test_budget.cjs shared.js
 *
 * ข้อค้างที่ 4 จาก release-v62: แถว Debt ที่รูดบัตรไม่เข้างบ → งบดู "เหลือ" เกินจริง
 * เกณฑ์ต้องตรงกับ debtSplit() (แถวที่แตะบัญชีเครดิต = รูดบัตร) และต้องไม่นับ
 * แถวจ่ายบัตร / ค่างวดจากธนาคาร / คืนเงิน
 */
const fs=require("fs");
const store={};
global.window={}; global.localStorage={
  getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v)}, removeItem:k=>{delete store[k]} };
eval(fs.readFileSync(process.argv[2]||'shared.js',"utf8"));
let fail=0;
const chk=(name,cond,detail)=>{ console.log(`  ${cond?'✓':'✗'} ${name}${detail?'  '+detail:''}`); if(!cond)fail++; };

const bals=[
  {name:'KBank',   balance:50000, type:'Account #'},
  {name:'KTC',     balance:-8000, type:'Credit Card #'},
  {name:'Rabbit',  balance:300,   type:'Travel Card #'},
];
const tx=(type,category,acct)=>({type,category,acct,
  amount:Object.values(acct).reduce((s,v)=>s+v,0)});

console.log('\n═══ budgetSpendMap ═══');
{
  const r=budgetSpendMap([tx('Expense','Foods & Drinks',{KBank:-300}), tx('Bills','Utility',{KBank:-1200})],bals);
  chk('Expense/Bills เท่าสูตรเดิม', r.map['Foods & Drinks']===300 && r.map.Utility===1200 && r.cardTotal===0,
      JSON.stringify(r));
}
{
  const r=budgetSpendMap([tx('Expense','Foods & Drinks',{KBank:-300}), tx('Debt','Foods & Drinks',{KTC:-500})],bals);
  chk('Debt รูดบัตรเข้าหมวด', r.map['Foods & Drinks']===800, JSON.stringify(r.map));
  chk('แยกยอดบัตรได้', r.card['Foods & Drinks']===500 && r.cardTotal===500, JSON.stringify(r.card));
}
{
  const r=budgetSpendMap([tx('Debt','Credit Card',{KBank:-8000, KTC:8000})],bals);
  chk('แถวจ่ายบัตร (−ธนาคาร +บัตร) ไม่นับ', Object.keys(r.map).length===0 && r.cardTotal===0, JSON.stringify(r));
}
{
  const r=budgetSpendMap([tx('Debt','Car loan',{KBank:-6500})],bals);
  chk('ค่างวดจากบัญชีธนาคารไม่นับ', Object.keys(r.map).length===0, JSON.stringify(r.map));
}
{
  const r=budgetSpendMap([tx('Debt','Foods & Drinks',{KTC:-500}), tx('Debt','Foods & Drinks',{KTC:200})],bals);
  chk('คืนเงินเข้าบัตร (ยอดบวก) ไม่นับ', r.map['Foods & Drinks']===500, JSON.stringify(r.map));
}
{
  const r=budgetSpendMap([tx('Debt','Travel',{Rabbit:-100})],bals);
  chk('Travel Card ไม่ถือเป็นบัตรเครดิต (v62 #8)', Object.keys(r.map).length===0, JSON.stringify(r.map));
}
{
  const r=budgetSpendMap([{type:'Debt',category:'',acct:{KTC:-90},amount:-90}],bals);
  chk('ไม่มีหมวด → Other', r.map.Other===90, JSON.stringify(r.map));
}
{
  const rows=[tx('Debt','Foods & Drinks',{KTC:-500}), tx('Debt','Car loan',{KBank:-6500})];
  const d=debtSplit(rows,bals), r=budgetSpendMap(rows,bals);
  chk('สอดคล้องกับ debtSplit (ยอดรูดบัตร)', Math.abs(d.card)===r.cardTotal, `debtSplit.card=${d.card} cardTotal=${r.cardTotal}`);
}
chk('ข้อมูลว่างไม่ throw', (()=>{ try{ const r=budgetSpendMap(null,null); return r.cardTotal===0; }catch(e){ return false; } })());

console.log(fail?`\n❌ ไม่ผ่าน ${fail} ข้อ`:'\n✅ ผ่านทั้งหมด');
process.exit(fail?1:0);
