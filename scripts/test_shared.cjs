/* ทดสอบ shared.js — data layer กลางของแอป (ไม่ต้องเปิดเบราว์เซอร์)
 *
 *   node scripts/test_shared.cjs shared.js
 *
 * คุมบั๊ก 3 ข้อที่เจอในรีวิว 19 ก.ย. 2026 — ทั้งสามให้ตัวเลขผิดแบบ "ดูน่าเชื่อ"
 * ซึ่งเป็นชนิดที่อันตรายที่สุดสำหรับแอปการเงิน:
 *
 *   1. classifyHoldings  ต้นทุนหลังขายบางส่วน → %กำไรผิดเป็นเท่าตัว (+800% แทน +80%)
 *   2. computeDeviations เป้ารวมได้ 95% เมื่อไม่มีกองทุนสำรองฯ ในพอร์ต
 *                        → ทุกกองดู over-weight เกินจริง ~5pp พร้อมกัน
 *   3. resolvePrices     ราคาที่จำไว้ไม่มีวันหมดอายุ และบันทึกอายุเป็น "วันนี้"
 *                        ทุกครั้ง ทำให้ราคาค้างกลายเป็นราคาใหม่ใช้ต่อได้ไม่จำกัด
 *
 * รันกับเวอร์ชันก่อนแก้จะเห็นข้อ 1-3 แดง — ใช้ยืนยันว่าเทสต์จับของจริง
 * ไม่ได้ผ่านเพราะเงื่อนไขเป็นจริงเสมอ (บทเรียนจาก test_line_notify.py)
 */
const fs=require("fs");
const store={};
global.window={}; global.localStorage={
  getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v)}, removeItem:k=>{delete store[k]} };
const src=fs.readFileSync(process.argv[2],"utf8");
eval(src);
let fail=0;
const chk=(name,cond,detail)=>{ console.log(`  ${cond?'✓':'✗'} ${name}${detail?'  '+detail:''}`); if(!cond)fail++; };
const near=(a,b,t=0.5)=>Math.abs(a-b)<=t;

console.log('\n═══ 1. classifyHoldings — ต้นทุนหลังขายบางส่วน ═══');
{
  const trades=[{date:new Date('2026-01-01'),type:'Buy',ticker:'X',qty:10,thb:10000},
                {date:new Date('2026-06-01'),type:'Sell',ticker:'X',qty:5,thb:9000}];
  const r=classifyHoldings(trades,[{ticker:'X',qty:5,val:9000,cost:5000}],{});
  const row=[...r.active,...r.dormant,...r.intentional][0];
  chk('ต้นทุน = ฿5,000 (WACC×netQty)', near(row.cost,5000), `ได้ ฿${row.cost.toLocaleString()}`);
  chk('%กำไร = +80% ไม่ใช่ +800%', near(row.plPct,80,0.1), `ได้ ${row.plPct.toFixed(1)}%`);
  // รายการนี้ซื้อครั้งสุดท้ายเกิน 180 วัน จึงอยู่กลุ่ม dormant ไม่ใช่ active
  const _b = r.dormant.length ? r.stats.dormant : r.stats.active;
  chk('ตัวเลขสรุปหัวการ์ดก็ถูกตาม', _b.plPct!=null&&near(_b.plPct,80,0.1), `ได้ ${_b.plPct==null?'null':_b.plPct.toFixed(1)+'%'}`);
  // ไม่เคยขายเลย ต้องยังถูกเหมือนเดิม
  const r2=classifyHoldings([{date:new Date('2026-01-01'),type:'Buy',ticker:'Y',qty:10,thb:10000}],
                            [{ticker:'Y',qty:10,val:12000,cost:10000}],{});
  const _r2=[...r2.active,...r2.dormant][0];
  chk('กรณีไม่เคยขาย ยังถูกเหมือนเดิม', near(_r2.plPct,20,0.1), `${_r2.plPct.toFixed(1)}%`);
  // ไม่มี a.cost → ใช้ fallback ยอดซื้อสะสม
  const r3=classifyHoldings([{date:new Date('2026-01-01'),type:'Buy',ticker:'Z',qty:10,thb:7000}],
                            [{ticker:'Z',qty:10,val:8000}],{});
  const _r3=[...r3.active,...r3.dormant][0];
  chk('ไม่มี a.cost → fallback WACC × จำนวนที่เหลือ', near(_r3.cost,7000), `฿${_r3.cost}`);

  // fallback ต้องหักส่วนที่ขายไปด้วย — เป็นจุดที่ถามกันว่า "ขายแล้วต้นทุนต้องลดไหม"
  // ซื้อ 10 @ ฿10,000 (WACC ฿1,000) · ขาย 5 ได้ ฿9,000 · เหลือ 5 หน่วย
  //   ต้นทุนที่ถูก = ฿1,000 × 5 = ฿5,000   (ไม่ใช่ ฿10,000 และไม่ใช่ ฿1,000)
  const r4=classifyHoldings(
    [{date:new Date('2026-01-01'),type:'Buy', ticker:'W',qty:10,thb:10000},
     {date:new Date('2026-06-01'),type:'Sell',ticker:'W',qty:5, thb:9000}],
    [{ticker:'W',qty:5,val:9000}], {});          // ← ไม่ส่ง a.cost มาเลย
  const _r4=[...r4.active,...r4.dormant][0];
  chk('fallback หักส่วนที่ขายไปถูกต้อง', near(_r4.cost,5000),
      `฿${_r4.cost.toLocaleString()} (เต็ม ฿10,000 = ไม่หัก · ฿1,000 = หักด้วยเงินที่ได้)`);
  chk('fallback ให้ %กำไรถูก', near(_r4.plPct,80,0.1), `${_r4.plPct.toFixed(1)}%`);
}

console.log('\n═══ 2. computeDeviations — เป้าต้องรวมได้ 100 เสมอ ═══');
for(const [label,alloc] of [
  ['ไม่มี Provident Fund', {'US Stock':{value:50000},'Thai Stock':{value:50000}}],
  ['มี Provident Fund',     {'US Stock':{value:50000},'Provident Fund':{value:50000}}],
  ['PF มีแต่ราคาเป็น 0',    {'US Stock':{value:100000},'Provident Fund':{value:0}}],
]){
  const r=computeDeviations({totalValue:100000,cashBalance:0,allocation:alloc});
  const st=r.list.reduce((s,x)=>s+x.target,0), sc=r.list.reduce((s,x)=>s+x.cur,0);
  chk(label, near(st,100,0.01)&&near(sc,100,0.01), `target=${st.toFixed(2)} cur=${sc.toFixed(2)}`);
}

console.log('\n═══ 3. resolvePrices — ราคาที่จำไว้ต้องหมดอายุ ═══');
{
  const iso=n=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
  const setLkp=o=>localStorage.setItem('finOS_lastPrice',JSON.stringify(o));
  localStorage.setItem('finOS_actions',JSON.stringify({prices:{},data:{}}));
  localStorage.setItem('finOS_market',JSON.stringify({data:{USDTHB:{value:33}}}));

  setLkp({OLD:{p:100,d:iso(687),src:'pipeline'}});
  chk('ราคาอายุ 687 วัน ถูกทิ้ง', !(resolvePrices({}).priceMap.OLD>0));

  setLkp({MID:{p:100,d:iso(10),src:'pipeline'}});
  const r2=resolvePrices({});
  chk('ราคาอายุ 10 วัน ยังใช้ได้', r2.priceMap.MID===100, `src=${r2.srcMap.MID} age=${r2.ageMap.MID}`);

  setLkp({EDGE:{p:100,d:iso(31),src:'pipeline'}});
  chk('อายุ 31 วัน (เกิน 30) ถูกทิ้ง', !(resolvePrices({}).priceMap.EDGE>0));

  setLkp({NOD:{p:100,src:'pipeline'}});
  chk('ไม่มีวันที่ = ไม่กล้าใช้', !(resolvePrices({}).priceMap.NOD>0));

  // ห้ามฟอกอายุ: ราคา stale 11 วัน ต้องถูกบันทึกด้วยวันของราคาจริง
  setLkp({});
  localStorage.setItem('finOS_actions',JSON.stringify(
    {prices:{ST:{price:50,ccy:'THB',updated:iso(11)}},data:{}}));
  const r3=resolvePrices({});
  const saved=JSON.parse(localStorage.getItem('finOS_lastPrice')).ST;
  chk('ราคา stale ติดธงถูก', r3.srcMap.ST==='stale', `age=${r3.ageMap.ST}`);
  chk('บันทึกวันของราคาจริง ไม่ใช่วันนี้', saved.d===iso(11), `บันทึก d=${saved.d} ควรเป็น ${iso(11)}`);

  /* v51 — อายุต้องไม่ขึ้นกับ "เวลาของวันที่รันเทสต์"
     บั๊กจริงที่เจอ: pipelinePricesTHB ใช้ Math.round ส่วน ageOf ใช้ Math.floor
     ราคาลงวันที่ N วันก่อน (00:00Z) พออ่านหลังเที่ยง UTC จะได้ N.6 วัน
     round → N+1  อายุจึงกระโดดกลางวัน และวันที่ที่คำนวณย้อนกลับเลื่อนไป 1 วัน
     ข้อข้างบนจับได้เฉพาะตอนรันช่วงบ่าย UTC — ลูปนี้จับได้ทุกเวลา */
  for(const n of [0,1,3,4,5,11,12]){
    setLkp({});
    localStorage.setItem('finOS_actions',JSON.stringify(
      {prices:{[`A${n}`]:{price:50,ccy:'THB',updated:iso(n)}},data:{}}));
    const rr=resolvePrices({});
    const sv=JSON.parse(localStorage.getItem('finOS_lastPrice'))[`A${n}`];
    chk(`อายุ ${n} วัน นับตรง ไม่ปัดขึ้น`, rr.ageMap[`A${n}`]===n,
        `ได้ ${rr.ageMap[`A${n}`]}`);
    chk(`อายุ ${n} วัน บันทึกวันเดิมกลับมาได้`, !!sv && sv.d===iso(n),
        `ได้ ${sv&&sv.d} ควรเป็น ${iso(n)}`);
  }
}

console.log('\n═══ ไม่ทำลายของเดิม ═══');
{
  localStorage.setItem('finOS_lastPrice','{}');
  localStorage.setItem('finOS_actions',JSON.stringify(
    {prices:{A:{price:10,ccy:'THB',updated:new Date().toISOString().slice(0,10)}},data:{}}));
  const r=resolvePrices({B:20});
  chk('pipeline สดชนะ', r.priceMap.A===10 && r.srcMap.A==='pipeline');
  chk('ราคาชีตยังใช้ได้', r.priceMap.B===20 && r.srcMap.B==='sheet');
  const q=priceQuality({A:'pipeline',B:'cached'},['A','B','C']);
  chk('priceQuality: degraded/missing ถูก', q.degraded===1 && q.missing.length===1);
  chk('priceQuality: trustworthy=false เมื่อมี cached', q.trustworthy===false);
}
console.log(fail?`\n❌ ไม่ผ่าน ${fail} ข้อ`:'\n✅ ผ่านทั้งหมด');
process.exit(fail?1:0);
