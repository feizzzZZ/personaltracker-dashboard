/* v92 — เทสต์หน้าจอ: เปิดแอปจริงใน Chromium กับ Google Sheets จำลอง (เก็บในหน่วยความจำ) แล้วกรอกฟอร์มเหมือนผู้ใช้
 *
 *   node tests/ui/test_ui_smoke.cjs [--out <โฟลเดอร์ภาพหน้าจอ>]
 *
 * ต้องมี Playwright + Chromium (CI: .github/workflows/tests.yml ติดตั้งให้)
 * CHART_JS=<path ของ chart.umd.js> → ใช้ไฟล์ในเครื่องแทน cdnjs (เครื่องที่ออกเน็ตไม่ได้)
 *
 * ข้อมูลทั้งหมดเป็นตัวเลขสมมติ — repo เป็น public ห้ามใส่ข้อมูลจริงจากชีต
 * แต่ละข้อมาจากบั๊กที่เคยเจอจริง (v85–v91) หรือสิ่งที่ v92 เพิ่ม: บันทึกลงช่องถูกต้อง · เตือนรายการซ้ำ · ต่ออายุ session
 * ระหว่างกรอก · sync หลังบันทึกไม่ดึงข้อมูลตลาด · ยอดจริงเก่าเกิน 45 วัน · ช่องวันที่ไม่ทับกันบน iPhone · ทุกหน้าเปิดได้ไม่มี error
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null; })();
if (OUT) fs.mkdirSync(OUT, { recursive: true });

let FAIL = 0;
const chk = (name, cond, detail) => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 400)}`); if (!cond) FAIL++; };

// ── ข้อมูลชีตสมมติ ─────────────────────────────────────────────────────────
const DAY = 864e5;
const isoAgo = n => { const d = new Date(Date.now() - n * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ser = iso => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / DAY;
const ACCT = ['Bank A', 'Bank B', 'Card C', 'Wallet D'];                 // คอลัมน์ G H I J
const pre = a => ['', '', '', '', '', ''].concat(a);
const TX = [pre(['Account #', 'Account #', 'Credit Card #', 'E-Wallet #']), pre(ACCT), ['Current Balance', '', '', '', '', '', 48380, 10000, -750, 500]];
while (TX.length < 24) TX.push([]);
TX.push(['Date', 'Month', 'Year', 'Transactions', 'Type', 'Details', 'Bank-A', 'Bank-B', 'Card-C', 'Wallet-D']);   // แถว 25
const txr = (iso, t, c, det, m) => { const a = [ser(iso), '', '', t, c, det, '', '', '', '']; Object.entries(m).forEach(([k, v]) => { a[6 + +k] = v; }); return a; };
TX.push(txr(isoAgo(40), 'Income', 'Salary', 'Company', { 0: 50000 }));                    // 26
TX.push(txr(isoAgo(35), 'Expense', 'Food', 'Lunch', { 2: -250 }));                        // 27
TX.push(txr(isoAgo(30), 'Debt', 'Clear Debt Card C', 'Card C', { 0: -1000, 2: 1000 }));   // 28
TX.push(txr(isoAgo(20), 'Transfer', 'Top up', 'Wallet D', { 0: -500, 3: 500 }));          // 29
const DUP_DATE = isoAgo(2);
TX.push(txr(DUP_DATE, 'Expense', 'Food', 'Coffee', { 0: -120 }));                         // 30

const store = {
  Transaction: { v: TX },
  Asset_Tracker: { v: [['Date', 'Transaction_Type', 'Ticker', 'Name', 'Asset_Type', 'Industry', 'Platform', 'FX_Rate', 'Quantity', 'Price', 'Commission_THB', 'Total_Amount_THB'],
    [isoAgo(60), 'Buy', 'ZZTEST', 'Test Co', 'Thai Stock', 'Banking', 'Broker X', 1, 100, 20, 0, 2000]] },
  Asset_Live_Price_Feed: { v: [['Ticker', 'Name', 'Current_Price_THB', 'Industry', 'Asset_Type', 'Active'],
    ['ZZTEST', 'Test Co', 25, 'Banking', 'Thai Stock', 'Active'], ['ZZNEW', 'New Co', 100, 'Technology', 'US Stock', 'Active']] },
  Reconcile: { v: [['Date', 'Account', 'Actual_Balance', 'Note'],
    [ser(isoAgo(3)), 'Bank A', 48500, ''],      // สด — 48,500 − ค่ากาแฟ 120 (2 วันก่อน) = 48,380 ตรงกับชีต
    [ser(isoAgo(80)), 'Card C', -700, '']] },    // เก่า 80 วัน → แอปกลับไปใช้ยอดคำนวณ ต้องบอกผู้ใช้
  Insurance_Policies: { v: [['Insurance Policies'], ['Status', 'Policy_ID', 'Provider', 'Plan_Name', 'Policy_Category', 'Annual_Premium', 'Renewal_Date', 'Policy_Date', 'Maturity_Date', 'Surrender_Value', 'Notes'],
    ['In-Force', 'POL-001', 'Insurer X', 'Health Plan', 'Health', 12000, ser(isoAgo(-120)), ser(isoAgo(900)), '', 0, '']] },
  Insurance_Coverage: { v: [['Insurance Coverage'], ['Policy_ID', 'Coverage_Type', 'Coverage_Amount', 'Unit', 'Benefit_Name', 'Target_Amount'],
    ['POL-001', 'Medical_IPD', 500000, 'Per Year', 'IPD', 0]] },
};

// ── Sheets API จำลอง ────────────────────────────────────────────────────────
const log = [];           // {m, kind, tab, range, auth, values}
const colN = s => { let c = 0; for (const ch of s) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
const parseRange = rg => {      // 'Tab!A5:M20' · 'Tab!A1:Z' · 'Tab!B7' · 'Tab!A1'
  const i = rg.lastIndexOf('!'), tab = rg.slice(0, i).replace(/^'|'$/g, ''), a = rg.slice(i + 1);
  const m = a.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
  if (!m) return { tab, c0: 0, r0: 0, c1: 25, r1: Infinity };
  return { tab, c0: colN(m[1]), r0: m[2] ? +m[2] - 1 : 0, c1: m[3] ? colN(m[3]) : (m[2] && !m[3] ? colN(m[1]) : 25), r1: m[3] ? (m[4] ? +m[4] - 1 : Infinity) : (m[2] ? +m[2] - 1 : Infinity) };
};
const readRange = (rg, formulas) => {
  const p = parseRange(rg), t = store[p.tab]; if (!t) return null;
  const out = [];
  for (let r = p.r0; r <= Math.min(p.r1, t.v.length - 1); r++) {
    const row = (t.v[r] || []).slice(p.c0, p.c1 + 1).map((v, j) => (formulas && t.f && t.f[r] && t.f[r][p.c0 + j]) || (v == null ? '' : v));
    while (row.length && row[row.length - 1] === '') row.pop();
    out.push(row);
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
};
const setCell = (tab, r, c, v) => { const t = store[tab]; while (t.v.length <= r) t.v.push([]); const row = t.v[r]; while (row.length <= c) row.push(''); row[c] = v; };
const unq = v => (typeof v === 'string' && v[0] === "'") ? v.slice(1) : v;
const lastUsed = t => { let n = t.v.length; while (n > 0 && !(t.v[n - 1] || []).some(x => String(x == null ? '' : x).trim() !== '')) n--; return n; };

async function sheetsRoute(rt) {
  const req = rt.request(), url = decodeURIComponent(req.url()), m = req.method();
  const auth = (req.headers().authorization || '').replace(/^Bearer /, '');
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const ok = j => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j || {}) });
  const bad = (st, msg) => rt.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify({ error: { code: st, message: msg } }) });
  if (auth !== 'tok' && auth !== 'tok2') { log.push({ m, kind: 'unauth', auth }); return bad(401, 'Invalid Credentials'); }
  const tabs = Object.keys(store);
  if (m === 'GET' && /\?fields=sheets/.test(url)) return ok({ sheets: tabs.map((t, i) => ({ properties: { title: t, sheetId: 100 + i } })) });
  if (m === 'GET' && /values:batchGet/.test(url)) {
    const ranges = [...url.matchAll(/ranges=([^&]+)/g)].map(x => x[1]);
    log.push({ m, kind: 'batchGet', ranges, auth });
    if (ranges.some(r => !store[parseRange(r).tab])) return bad(400, 'Unable to parse range');
    return ok({ valueRanges: ranges.map(r => ({ range: r, values: readRange(r) })) });
  }
  if (m === 'GET' && /\/values\//.test(url)) {
    const rg = url.match(/\/values\/([^?]+)/)[1];
    log.push({ m, kind: 'get', range: rg, auth });
    const v = readRange(rg, /valueRenderOption=FORMULA/.test(url));
    return v ? ok({ range: rg, values: v }) : bad(400, 'Unable to parse range: ' + rg);
  }
  if (m === 'POST' && /values:batchUpdate/.test(url)) {
    body.data.forEach(d => { const p = parseRange(d.range); d.values.forEach((row, i) => row.forEach((v, j) => setCell(p.tab, p.r0 + i, p.c0 + j, unq(v)))); });
    log.push({ m, kind: 'write', auth, data: body.data.map(d => [d.range, d.values[0][0]]) });
    return ok({});
  }
  if (m === 'POST' && /:append/.test(url)) {
    const tab = parseRange(url.match(/\/values\/([^:?]+)/)[1]).tab, t = store[tab];
    const at = lastUsed(t);
    body.values.forEach((row, i) => row.forEach((v, j) => setCell(tab, at + i, j, unq(v))));
    log.push({ m, kind: 'append', tab, auth, values: body.values, row: at + 1 });
    return ok({ updates: { updatedRange: `${tab}!A${at + 1}` } });
  }
  if (m === 'PUT' && /\/values\//.test(url)) {
    const p = parseRange(url.match(/\/values\/([^?]+)/)[1]);
    body.values.forEach((row, i) => row.forEach((v, j) => setCell(p.tab, p.r0 + i, p.c0 + j, unq(v))));
    log.push({ m, kind: 'put', tab: p.tab, auth, values: body.values });
    return ok({});
  }
  if (m === 'POST' && /:batchUpdate/.test(url)) {
    for (const q of body.requests) {
      if (q.addSheet) { store[q.addSheet.properties.title] = { v: [] }; log.push({ m, kind: 'addSheet', tab: q.addSheet.properties.title }); }
      if (q.deleteDimension) { const tab = tabs[q.deleteDimension.range.sheetId - 100]; store[tab].v.splice(q.deleteDimension.range.startIndex, 1); log.push({ m, kind: 'deleteRow', tab }); }
      if (q.copyPaste) log.push({ m, kind: 'copyFormula' });
    }
    return ok({});
  }
  return ok({});
}

// ── เว็บเซิร์ฟเวอร์ของไฟล์ใน repo (path เดียวกับ GitHub Pages) ────────────────
const served = [];
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  served.push(u);
  if (!u.startsWith('/personaltracker-dashboard/')) { s.writeHead(404); return s.end(); }
  let f = path.join(ROOT, u.slice('/personaltracker-dashboard/'.length));
  if (!f.startsWith(ROOT)) { s.writeHead(403); return s.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(s);
});

async function newContext(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }, opts || {}));
  // gs_scope_ver = 2 — ไม่งั้น gsInit() (ตอน load) ล้าง gs_ever_connected ทิ้งเพราะคิดว่าเป็น token สิทธิ์อ่านอย่างเดียวรุ่นเก่า
  await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('finOS_lang', 'th'); localStorage.setItem('gs_scope_ver', '2'); } catch (e) {} });
  if (process.env.CHART_JS) await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js/, rt => rt.fulfill({ path: process.env.CHART_JS, contentType: 'application/javascript' }));
  await ctx.route(/sheets\.googleapis\.com/, sheetsRoute);
  await ctx.route(/googleapis\.com\/oauth2/, rt => rt.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route(/fonts\.g|accounts\.google|gstatic|binance|workers\.dev|publicnode/, rt => rt.abort());
  return ctx;
}

async function openApp(ctx, port) {
  const p = await ctx.newPage();
  const errs = [], warns = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { errs.push('DIALOG: ' + d.message().slice(0, 160)); d.dismiss().catch(() => {}); });
  p.on('console', m => {
    const t = m.text();
    if (m.type() === 'warning' && /^\[(v44|Page|build|div|guard|feeds\] freshness)/.test(t)) warns.push(t);
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|WebSocket|net::/.test(t)) warns.push('error: ' + t);
  });
  await p.goto(`http://127.0.0.1:${port}/personaltracker-dashboard/`, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('load');
  await p.waitForFunction(() => typeof Chart !== 'undefined' && typeof gsSync === 'function', null, { timeout: 30000 });
  await p.evaluate(async () => {
    document.getElementById('up').style.display = 'none'; document.getElementById('app').style.display = 'flex';
    GS_CONFIG.spreadsheetId = 'MOCK'; GS_CONFIG.clientId = 'test-client';
    gsAccessToken = 'tok'; gsTokenExpiry = Date.now() + 3600e3; gsConnected = true;
    localStorage.setItem('gs_ever_connected', '1');
    // library Google Sign-In จริงถูกบล็อกในเทสต์ — แทนด้วยตัวปลอมที่ไม่ทำอะไร (แต่ละข้อเปลี่ยน gsTokenClient เอง)
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    gsTokenClient = google.accounts.oauth2.initTokenClient({});
    await gsSync();
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const n = document.getElementById('lock-nudge'); if (n) n.remove(); });
  return { p, errs, warns };
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const shot = async (p, n) => { if (OUT) await p.screenshot({ path: path.join(OUT, n + '.png') }).catch(() => {}); };
  try {
    const ctx = await newContext(browser);
    const { p, errs, warns } = await openApp(ctx, port);
    const val = id => p.$eval('#' + id, e => e.value);
    const txt = sel => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const isOpen = id => p.$eval('#' + id, e => e.classList.contains('show'));
    const closeAll = () => p.evaluate(() => { document.querySelectorAll('.gs-modal-overlay.show').forEach(m => m.classList.remove('show')); try { txCloseForm(); atCloseForm(); } catch (e) {} });
    const since = n => log.slice(n);
    const waitClosed = (id, ms) => p.waitForFunction(i => !document.getElementById(i).classList.contains('show'), id, { timeout: ms || 8000 }).then(() => true).catch(() => false);

    console.log('\n═══ เปิดแอป + sync ครั้งแรก ═══');
    const b = await p.evaluate(() => ({ shared: window.SHARED_BUILD, expected: EXPECTED_SHARED_BUILD, tx: txRows.length, assets: assets.length, banks: bankBals.length }));
    chk(`shared.js (${b.shared}) ตรงกับ index.html (${b.expected})`, b.shared && b.shared === b.expected, b);
    chk('อ่านรายการ 5 แถว · ถือหุ้น 1 ตัว · 4 บัญชี', b.tx === 5 && b.assets === 1 && b.banks === 4, b);
    const first = log.filter(x => x.kind === 'batchGet');
    chk('sync อ่านชีต 8 ครั้ง (แท็บหลัก 1 + แท็บเสริม 7 — แท็บที่ไม่มีข้ามได้)', first.length === 8, first.map(x => x.ranges.join()));
    chk('sync ครั้งแรกดึง market-data.json', served.some(u => /data\/market-data\.json$/.test(u)));

    console.log('\n═══ ทุกหน้าเปิดได้ ไม่มี error ═══');
    const pages = await p.evaluate(() => Object.keys(pageRenderFns));
    for (const pg of pages) { await p.evaluate(x => switchPage(x), pg); await p.waitForTimeout(120); }
    chk(`${pages.length} หน้า · ไม่มี page error`, errs.length === 0, errs);
    chk('ไม่มีคำเตือน render ([div] [Page] [guard] …)', warns.length === 0, warns);
    await p.evaluate(() => switchPage('accounts')); await p.waitForTimeout(300);

    console.log('\n═══ ยอดจริงเก่ากว่า 45 วัน ═══');
    const cardC = await p.$$eval('#acc-bank-grid .bank-card', a => (a.find(c => /Card C/.test(c.innerText)) || {}).innerText || '');
    chk('การ์ด Card C บอกว่ายอดจริงเก่า 80 วัน', /⏳/.test(cardC) && /80/.test(cardC), cardC);
    const bankA = await p.$$eval('#acc-bank-grid .bank-card', a => (a.find(c => /Bank A/.test(c.innerText)) || {}).innerText || '');
    chk('การ์ด Bank A (ยอดจริง 3 วัน) ไม่มีคำเตือนเก่า · มี ✓', !/⏳/.test(bankA) && /✓/.test(bankA), bankA);
    await p.evaluate(() => switchPage('overview')); await p.waitForTimeout(300);
    const ov = await p.$eval('#ov-action', e => e.textContent.replace(/\s+/g, ' '));   // เรื่องที่ 4+ ซ่อนไว้ใต้ "ดูอีก" — ใช้ textContent
    chk('หน้าภาพรวม "ต้องลงมือ" บอกยอดจริงเก่ากว่า 45 วัน', /เก่ากว่า 45 วัน/.test(ov), ov.slice(0, 300));
    await shot(p, 'overview');

    console.log('\n═══ ปุ่ม + ═══');
    await p.evaluate(() => fabRender());
    const fab = await p.$$eval('#fab-menu .fab-opt', a => a.map(x => x.dataset.k + (x.disabled ? '(off)' : '')));
    chk('13 รายการ เปิดได้ทุกอัน', fab.length === 13 && !fab.some(k => /off/.test(k)), fab);

    console.log('\n═══ บันทึกรายรับ: ช่องและเครื่องหมายถูก · sync หลังบันทึกไม่ดึงข้อมูลตลาด ═══');
    let n0 = log.length, s0 = served.length;
    await p.evaluate(() => fabPick('tx')); await p.waitForTimeout(200);
    await p.selectOption('#tx-f-type', 'Income'); await p.selectOption('#tx-f-acct', '6'); await p.fill('#tx-f-cat', 'Bonus'); await p.fill('#tx-f-amt', '1234.5');
    await p.click('#tx-f-save'); const closed = await waitClosed('tx-modal');
    const w1 = since(n0).filter(x => x.kind === 'write');
    chk('ฟอร์มปิด + ข้อความ "บันทึกลงชีตแล้ว"', closed && /บันทึก/.test(await txt('#saved-toast')), await txt('#tx-f-status'));
    chk('เขียนแถว 31: Income · Bonus · Bank A +1234.5', w1.length === 1 && JSON.stringify(w1[0].data).includes('"Transaction!D31","Income"')
      && JSON.stringify(w1[0].data).includes('"Transaction!G31",1234.5'), w1.map(x => x.data));
    const after = since(n0).filter(x => x.kind === 'batchGet');
    chk('sync หลังบันทึกอ่านชีต 8 ครั้ง (แท็บเสริมพร้อมกัน)', after.length === 8, after.length);
    chk('sync หลังบันทึกไม่ดึง market-data.json ซ้ำ', !served.slice(s0).some(u => /market-data\.json/.test(u)), served.slice(s0));
    chk('รายการใหม่เข้าแอปแล้ว (6 แถว)', await p.evaluate(() => txRows.length) === 6);

    console.log('\n═══ เตือนรายการซ้ำ ═══');
    n0 = log.length;
    await p.evaluate(() => fabPick('tx')); await p.waitForTimeout(200);
    await p.fill('#tx-f-date', DUP_DATE_PLACEHOLDER());
    await p.selectOption('#tx-f-type', 'Expense'); await p.selectOption('#tx-f-acct', '6'); await p.fill('#tx-f-cat', 'Food'); await p.fill('#tx-f-amt', '120');
    await p.click('#tx-f-save'); await p.waitForTimeout(300);
    const dupMsg = await txt('#tx-f-status');
    chk('กดครั้งแรก: เตือน "มีรายการนี้ในชีตแล้ว (แถว 30 …)" ไม่เขียน', /แถว 30/.test(dupMsg) && await isOpen('tx-modal') && !since(n0).some(x => x.kind === 'write'), dupMsg);
    await shot(p, 'dup-warning');
    await p.click('#tx-f-save'); await waitClosed('tx-modal');
    chk('กดอีกครั้ง = ยืนยัน → เขียนลงชีต', since(n0).filter(x => x.kind === 'write').length === 1);
    n0 = log.length;
    await p.evaluate(() => fabPick('tx')); await p.waitForTimeout(200);
    await p.fill('#tx-f-date', DUP_DATE_PLACEHOLDER());
    await p.selectOption('#tx-f-type', 'Expense'); await p.selectOption('#tx-f-acct', '6'); await p.fill('#tx-f-cat', 'Food'); await p.fill('#tx-f-amt', '121');
    await p.click('#tx-f-save'); await waitClosed('tx-modal');
    chk('ยอดต่างกัน → ไม่เตือน บันทึกเลย', since(n0).filter(x => x.kind === 'write').length === 1);

    console.log('\n═══ โอน · จ่ายบัตร ═══');
    await p.evaluate(() => fabPick('xfer')); await p.waitForTimeout(200);
    const xf = { from: await val('tx-f-acct'), to: await val('tx-f-acct2') };
    chk('โอน: บัญชีปลายทางเริ่มต้นไม่ใช่บัญชีเดียวกับต้นทาง', xf.from !== xf.to, xf);
    await closeAll();
    n0 = log.length;
    await p.evaluate(() => fabPick('card')); await p.waitForTimeout(200);
    await p.fill('#tx-f-amt', '300'); await p.selectOption('#tx-f-acct', '6');
    await p.selectOption('#tx-f-acct2', '8');
    await p.click('#tx-f-save'); await waitClosed('tx-modal');
    const wc = JSON.stringify(since(n0).filter(x => x.kind === 'write').map(x => x.data));
    chk('จ่ายบัตร: Bank A −300 และ Card C +300 ในแถวเดียว', /"Transaction!G\d+",-300/.test(wc) && /"Transaction!I\d+",300/.test(wc), wc);

    console.log('\n═══ Session หมดอายุระหว่างกรอก ═══');
    // ต่ออายุเงียบสำเร็จ → บันทึกต่อได้เลย ไม่ต้องปิดฟอร์ม
    await p.evaluate(() => { gsTokenExpiry = Date.now() + 30e3;   // เหลือ 30 วินาที (< 3 นาที) = ต้องต่ออายุก่อนเขียน
      gsTokenClient = { requestAccessToken() { setTimeout(() => gsTokenCallback({ access_token: 'tok2', expires_in: 3600 }), 50); } }; });
    n0 = log.length;
    await p.evaluate(() => fabPick('tx')); await p.waitForTimeout(200);
    await p.selectOption('#tx-f-type', 'Income'); await p.fill('#tx-f-cat', 'Refund'); await p.fill('#tx-f-amt', '77');
    await p.click('#tx-f-save'); await waitClosed('tx-modal');
    const w2 = since(n0).filter(x => x.kind === 'write');
    chk('token ใกล้หมด → ต่ออายุเงียบ แล้วเขียนด้วย token ใหม่', w2.length === 1 && w2[0].auth === 'tok2', { auth: w2.map(x => x.auth), msg: await txt('#tx-f-status') });
    // ต่ออายุเงียบไม่ได้ → แถบเข้าสู่ระบบ · ฟอร์มยังเปิด ค่าที่กรอกยังอยู่ · เข้าระบบแล้วกดบันทึกซ้ำได้
    await p.evaluate(() => { gsTokenExpiry = 0; gsTokenClient = { requestAccessToken() { throw new Error('popup blocked'); } }; });
    n0 = log.length;
    await p.evaluate(() => fabPick('tx')); await p.waitForTimeout(200);
    await p.selectOption('#tx-f-type', 'Expense'); await p.fill('#tx-f-cat', 'Taxi'); await p.fill('#tx-f-amt', '88');
    await p.click('#tx-f-save'); await p.waitForTimeout(400);
    const st = { msg: await txt('#tx-f-status'), bar: await p.$eval('#reauth-bar', e => e.classList.contains('show')).catch(() => false), open: await isOpen('tx-modal'), amt: await val('tx-f-amt') };
    chk('ต่ออายุไม่ได้: แถบ "เข้าสู่ระบบ Google" · ฟอร์มยังเปิด · ยอดที่กรอกยังอยู่ · ไม่เขียน', st.bar && st.open && st.amt === '88' && /🔑/.test(st.msg)
      && !since(n0).some(x => x.kind === 'write'), st);
    await shot(p, 'reauth');
    await p.evaluate(() => { gsTokenClient = { requestAccessToken() { setTimeout(() => gsTokenCallback({ access_token: 'tok2', expires_in: 3600 }), 50); } }; });
    await p.click('#reauth-bar button'); await p.waitForTimeout(1200);
    chk('กดเข้าสู่ระบบ → แถบบอก "กดบันทึกอีกครั้ง" · ฟอร์มยังเปิดพร้อมค่าเดิม', /บันทึกอีกครั้ง/.test(await txt('#reauth-bar')) && await isOpen('tx-modal') && await val('tx-f-amt') === '88');
    n0 = log.length;
    await p.click('#tx-f-save'); await waitClosed('tx-modal');
    chk('กดบันทึกอีกครั้ง → เขียนลงชีต', since(n0).filter(x => x.kind === 'write').length === 1);

    console.log('\n═══ ฟอร์มลงทุน ═══');
    await p.evaluate(() => fabPick('at')); await p.waitForTimeout(300);
    await p.fill('#at-f-ticker', 'ZZTEST'); await p.dispatchEvent('#at-f-ticker', 'input'); await p.waitForTimeout(100);
    const a1 = { asset: await val('at-f-asset'), platform: await val('at-f-platform') };
    await p.fill('#at-f-ticker', 'ZZNEW'); await p.dispatchEvent('#at-f-ticker', 'input'); await p.waitForTimeout(100);
    const a2 = { asset: await val('at-f-asset'), platform: await val('at-f-platform') };
    chk('เปลี่ยน ticker → ค่าที่ฟอร์มเติมเองของตัวเดิมไม่ค้าง', a1.platform === 'Broker X' && a2.platform === '', { a1, a2 });
    await p.fill('#at-f-ticker', 'ZZTEST'); await p.dispatchEvent('#at-f-ticker', 'input');
    await p.selectOption('#at-f-type', 'Buy'); await p.fill('#at-f-date', ATDATE()); await p.fill('#at-f-qty', '100'); await p.fill('#at-f-price', '20'); await p.dispatchEvent('#at-f-price', 'input');
    n0 = log.length;
    await p.click('#at-f-save'); await p.waitForTimeout(400);
    chk('ซื้อซ้ำกับแถว 2 (วัน · จำนวน · ราคาเดียวกัน) → เตือนก่อน', /แถว 2/.test(await txt('#at-f-status')) && !since(n0).some(x => x.kind === 'write' || x.kind === 'append'), await txt('#at-f-status'));
    await p.fill('#at-f-qty', '10'); await p.dispatchEvent('#at-f-qty', 'input');
    await p.click('#at-f-save'); await waitClosed('at-modal');
    const wa = since(n0).filter(x => x.kind === 'write');
    chk('จำนวนต่าง → เขียนแถวใหม่ใน Asset_Tracker', wa.length === 1 && JSON.stringify(wa[0].data).includes('Asset_Tracker!C3'), wa.map(x => x.data));

    console.log('\n═══ ยอดจริงจากธนาคาร ═══');
    await p.evaluate(() => fabPick('rc')); await p.waitForTimeout(300);
    const oldLbl = await p.$eval('#rc-body .rc-row[data-n="Card C"] small', e => ({ t: e.textContent, old: e.classList.contains('rc-old') }));
    chk('แถว Card C บอกว่าจดล่าสุดเก่า 80 วัน', oldLbl.old && /80/.test(oldLbl.t), oldLbl);
    n0 = log.length;
    await p.fill('#rc-body .rc-row[data-n="Card C"] .rc-in', '800');
    await p.click('#rc-save'); await waitClosed('rc-modal');
    const ra = since(n0).filter(x => x.kind === 'append');
    chk('บัตรกรอกยอดค้าง 800 → เก็บ −800', ra.length === 1 && ra[0].tab === 'Reconcile' && ra[0].values[0][2] === -800, ra);
    await p.evaluate(() => switchPage('accounts')); await p.waitForTimeout(300);
    const cardC2 = await p.$$eval('#acc-bank-grid .bank-card', a => (a.find(c => /Card C/.test(c.innerText)) || {}).innerText || '');
    chk('จดใหม่แล้ว → การ์ด Card C ไม่ขึ้นว่าเก่าอีก', !/⏳/.test(cardC2), cardC2);

    chk('ทั้งรอบไม่มี page error / dialog', errs.length === 0, errs);
    chk('ทั้งรอบไม่มีคำเตือน render', warns.length === 0, warns);
    await ctx.close();

    console.log('\n═══ iPhone: ช่องวันที่ไม่ทับช่องข้าง ๆ ═══');
    const m = await newContext(browser, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const mob = await openApp(m, port);
    // iOS ให้ input วันที่กว้างอย่างน้อยเท่าข้อความ ("12 Nov BE 2569") และไม่สน width:100% — Chromium ไม่ทำแบบนั้น จึงจำลองด้วย min-width
    await mob.p.addStyleTag({ content: 'input[type="date"]{min-width:236px}' });
    for (const [k, modal] of [['tx', 'tx-modal'], ['at', 'at-modal'], ['debt', 'dbf-modal']]) {
      await mob.p.evaluate(x => fabPick(x), k); await mob.p.waitForTimeout(300);
      const o = await mob.p.evaluate(id => {
        const box = document.querySelector('#' + id + ' .gs-modal, #' + id + ' > div');
        const ins = [...document.querySelectorAll('#' + id + ' input, #' + id + ' select')].filter(e => e.offsetParent && e.type !== 'hidden' && e.type !== 'checkbox');
        const R = ins.map(e => ({ id: e.id, r: e.getBoundingClientRect() }));
        const hit = [];
        R.forEach(a => R.forEach(b => { if (a.id < b.id && a.r.left < b.r.right - 1 && b.r.left < a.r.right - 1 && a.r.top < b.r.bottom - 1 && b.r.top < a.r.bottom - 1) hit.push(a.id + '×' + b.id); }));
        const wide = R.filter(a => a.r.right > window.innerWidth + 1).map(a => a.id);
        return { hit, wide, n: R.length, scroll: box ? box.scrollWidth > box.clientWidth + 1 : false };
      }, modal);
      chk(`${k}: ${o.n} ช่อง · ไม่ทับกัน · ไม่ล้นจอ`, o.n > 2 && !o.hit.length && !o.wide.length, o);
      await shot(mob.p, 'iphone-' + k);
      await mob.p.evaluate(() => { document.querySelectorAll('.gs-modal-overlay.show').forEach(x => x.classList.remove('show')); try { txCloseForm(); atCloseForm(); dbfClose(); } catch (e) {} });
    }
    chk('มือถือ: ไม่มี page error', mob.errs.length === 0, mob.errs);
    await m.close();
  } catch (e) {
    console.error('HARNESS', e); FAIL++;
  } finally {
    await browser.close(); server.close();
  }
  console.log(FAIL ? `\n✗ ${FAIL} ข้อไม่ผ่าน` : '\n✓ ผ่านทั้งหมด');
  process.exit(FAIL ? 1 : 0);
})();

// วันที่ที่ใช้กรอกในฟอร์ม (รูปแบบ input type=date)
function DUP_DATE_PLACEHOLDER() { return DUP_DATE; }
function ATDATE() { return store.Asset_Tracker.v[1][0]; }
