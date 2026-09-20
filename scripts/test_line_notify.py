#!/usr/bin/env python3
"""ทดสอบ line_notify.py ด้วยข้อมูลจำลองที่มี shape เหมือนชีตจริง (ไม่ยิง LINE)"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("MARKET_DATA_OUT", "/tmp/t-market.json")
os.environ.setdefault("NOTIFY_STATE", "/tmp/t-state.json")

# วันที่ต้องคำนวณจาก "วันนี้" เสมอ — เดิมฝัง "2026-09-14" ตายตัว
# พอเกิน PRICE_STALE_DAYS (4 วัน) ราคาก็กลายเป็น stale แล้วเทสต์พังทั้งไฟล์
# ตั้งแต่บรรทัดกลางๆ ทำให้ทุกอย่างหลังจากนั้นไม่เคยถูกรันเลย
import datetime as _dt                                              # noqa: E402
_TODAY = _dt.datetime.now(_dt.timezone(_dt.timedelta(hours=7))).date()
_D = lambda n: (_TODAY - _dt.timedelta(days=n)).isoformat()   # noqa: E731

MARKET = {
    "generated_at": _D(0) + "T06:30:00+00:00",
    "data": {"USDTHB": {"value": 33.25}, "SET_INDEX": {"value": 1284.55},
             "SP500": {"value": 6712.4}, "VIX": {"value": 15.13}},
    "prices": {
        "AAPL": {"price": 265.0, "ccy": "USD", "updated": _D(1)},
        "KBANK": {"price": 158.5, "ccy": "THB", "updated": _D(1)},
        "BTC": {"price": 118500.0, "ccy": "USD", "updated": _D(0)},
        "Gold": {"price": 4430.0, "ccy": "USD", "updated": _D(1)},
        # TPAC มีในพอร์ตแต่ไม่มีราคา → ต้องขึ้นเตือน ไม่ใช่นับเป็น ฿0
    },
}
HEAD = ["Date", "Transaction_Type", "Ticker", "Asset_Type", "Industry", "Platform",
        "FX_Rate", "Quatity", "Price", "Commission_THB", "Total_Amout_THB"]
ROWS = [
    HEAD,
    # ── ซื้อปกติ · ค่าธรรมเนียม "ยังไม่รวม" ในยอด (100×250×33 = 825,000) ──
    ["2026-01-05", "Buy", "AAPL", "US_Stock", "Tech", "IBKR", 33, 10, 250, 200, 82500],
    # ── ซื้อ · ค่าธรรมเนียม "รวมแล้ว" (1000×150 = 150,000 + 150 = 150,150) ──
    ["2026-02-10", "Buy", "KBANK", "Thai_Stock", "Bank", "SCBS", 1, 1000, 150, 150, 150150],
    ["2026-03-01", "Buy", "BTC", "Cryptocurrency", "—", "Binance_Global_Spot",
     32, 0.05, 95000, 0, 152000],
    # ── ขายบางส่วน ──
    ["2026-06-01", "Sell", "KBANK", "Thai_Stock", "Bank", "SCBS", 1, 300, 160, 50, 48000],
    # ── ปันผล: ไม่กระทบจำนวนหุ้น แต่ต้องนับสะสม ──
    ["2026-07-15", "Dividend Payout", "KBANK", "Thai_Stock", "Bank", "SCBS",
     1, 0, 0, 0, 4200],
    # ── Asset_Type ว่าง แต่ platform เป็น exchange → ต้องเดาเป็นคริปโต ──
    ["2026-04-01", "Buy", "BNB", "", "—", "bitkub", 1, 2, 30000, 0, 60000],
    # ── ทอง ──
    ["2026-05-27", "Buy", "Gold", "Gold", "—", "Vault", 32.5, 1, 4200, 0, 136500],
    # ── ถือแต่ไม่มีราคาใน pipeline ──
    ["2026-05-01", "Buy", "PF4103", "Provident_Fund", "—", "KTAM", 1, 500, 12, 0, 6000],
    # ── แถวขยะที่ต้องถูกข้าม ──
    ["", "", "", "", "", "", "", "", "", "", ""],
]
# TPAC: ถือจริงแต่ไม่มีราคาทั้งสองแหล่ง (pipeline ไม่มี · ชีตเป็น 0)
# ต้องหลุดออกจากยอดรวมและขึ้นเตือน ไม่ใช่ถูกนับเป็น ฿0 เงียบๆ
ROWS_TPAC = ROWS + [
    ["2026-04-20", "Buy", "TPAC", "Thai_Stock", "Packaging", "SCBS",
     1, 1000, 10, 0, 10000],
]

with open(os.environ["MARKET_DATA_OUT"], "w", encoding="utf-8") as f:
    json.dump(MARKET, f)
if os.path.exists(os.environ["NOTIFY_STATE"]):
    os.remove(os.environ["NOTIFY_STATE"])

import line_notify as LN  # noqa: E402

# ── แท็บ Asset_Live_Price_Feed ที่ชีตจริงมี ────────────────────────────
# ครอบคลุมเคสที่เจอจริง: กองทุนที่ Yahoo ไม่มี, #N/A จาก IMPORTXML,
# แถว Inactive และราคา 0 ที่ต้องไม่ถูกนับ
PRICE_ROWS = [
    ["Ticker", "Current_Price_THB", "Active"],
    ["PF4103", 13.4521, "Active"],          # provident fund — มีแต่ในชีต
    ["K-VIETNAM", 11.8734, "Active"],
    ["BNB", 31000, "Active"],               # ชีตมี แต่ pipeline ไม่มี
    ["KBANK", 999, "Inactive"],             # Inactive → ต้องไม่ใช้
    ["AAPL", "#N/A", "Active"],             # สูตรล้ม → ต้องไม่กลายเป็น 0
    ["TPAC", 0, "Active"],                  # 0 → ไม่ใช่ราคา
]

port = LN.build_portfolio(ROWS, MARKET, PRICE_ROWS)
assert port, "build_portfolio คืน None"

print("═══ พอร์ตที่คำนวณได้ ═══")
for tk, h in sorted(port["holdings"].items()):
    print(f"  {tk:<8} qty={h['qty']:<10.4f} value={h['value']:>14,.2f} "
          f"cost={h['cost']:>12,.2f}  [{h['group']}]")
print(f"  รวม {port['total']:,.2f} · ต้นทุน {port['cost']:,.2f} "
      f"· ปันผล {port['dividends']:,.2f}")
print(f"  ไม่มีราคา: {port['missing']}")

# ── ตรวจตัวเลขทีละข้อ ────────────────────────────────────────────────
def near(a, b, tol=0.51):
    assert abs(a - b) <= tol, f"คาด {b:,.2f} ได้ {a:,.2f}"

# AAPL: ซื้อ 10 · ยอด 82,500 · base = 10×250×33 = 82,500 → gap=0, comm=200
#       |0-200| > max(.02, 10) → ยังไม่รวม → ต้นทุนจริง 82,700
near(port["holdings"]["AAPL"]["cost"], 82700)
near(port["holdings"]["AAPL"]["value"], 10 * 265 * 33.25)

# KBANK: ซื้อ 1000 ยอด 150,150 · base = 150,000 · gap = 150 = comm → รวมแล้ว
#        ต้นทุนต่อหน่วย = 150,150/1000 = 150.15 · เหลือ 700 หุ้น → 105,105
near(port["holdings"]["KBANK"]["qty"], 700)
near(port["holdings"]["KBANK"]["cost"], 700 * 150.15)
near(port["holdings"]["KBANK"]["value"], 700 * 158.5)

# BTC เป็น USD → ต้องคูณ FX ของ "วันนี้" (33.25) ไม่ใช่ FX ตอนซื้อ (32)
near(port["holdings"]["BTC"]["value"], 0.05 * 118500 * 33.25)

# Asset_Type ว่าง + platform = bitkub → ต้องเดาเป็นคริปโต
assert LN.resolve_group("", "BNB", "bitkub") == "คริปโต", "เดา group จาก platform ไม่ทำงาน"
assert LN.resolve_group("", "BTC", "Unknown") == "คริปโต", "เดา group จาก ticker ไม่ทำงาน"
assert LN.resolve_group("Weird_Type", "XYZ", "SCBS") == "อื่นๆ", \
    "ประเภทที่ไม่รู้จักต้องตกไป 'อื่นๆ' ให้เห็น ไม่ใช่โดนกลืนเข้าคริปโต"
# ══ chain ราคา: pipeline สด > ชีต > pipeline ค้าง ══════════════════
# BNB กับ PF4103 ไม่มีใน pipeline แต่ชีตมี → ต้องเข้าพอร์ตได้แล้ว
assert port["holdings"]["BNB"]["src"] == "sheet", port["holdings"]["BNB"]
near(port["holdings"]["BNB"]["value"], 2 * 31000)
assert port["holdings"]["PF4103"]["src"] == "sheet"
near(port["holdings"]["PF4103"]["value"], 500 * 13.4521)
assert not port["missing"], f"ไม่ควรมีตัวไหนขาดราคาแล้ว: {port['missing']}"

# AAPL มีทั้งสองแหล่ง แต่ชีตเป็น #N/A → ต้องใช้ pipeline ไม่ใช่กลายเป็น 0
assert port["holdings"]["AAPL"]["src"] == "pipeline"
near(port["holdings"]["AAPL"]["value"], 10 * 265 * 33.25)

# KBANK ในชีตเป็น Inactive (999 บาท) → ต้องถูกข้าม ใช้ pipeline 158.5 แทน
assert port["holdings"]["KBANK"]["src"] == "pipeline"
near(port["holdings"]["KBANK"]["value"], 700 * 158.5)

# แถวราคา 0 ต้องไม่ถูกตีความว่าเป็นราคา
_p_tpac = LN.build_portfolio(ROWS_TPAC, MARKET, PRICE_ROWS)
assert "TPAC" in _p_tpac["missing"], "ตัวที่ไม่มีราคาต้องขึ้นในรายการเตือน"
assert "TPAC" not in _p_tpac["holdings"], "ตัวที่ไม่มีราคาต้องไม่อยู่ในพอร์ต"
assert _p_tpac["total"] == port["total"], "ตัวไม่มีราคาต้องไม่ถูกนับเป็น ฿0 ในยอดรวม"
assert "ไม่มีราคา" in LN.daily_message(_p_tpac, MARKET, {}), "ข้อความไม่ได้เตือน"
print("✓ ตัวที่ไม่มีราคาถูกกันออกและรายงาน ไม่ใช่นับเป็น ฿0")

assert "TPAC" not in LN.parse_live_prices(PRICE_ROWS)
assert "KBANK" not in LN.parse_live_prices(PRICE_ROWS), "Inactive หลุดเข้ามา"
assert "AAPL" not in LN.parse_live_prices(PRICE_ROWS), "#N/A หลุดเข้ามา"

# ราคาค้างเกิน PRICE_MAX_DAYS ต้องถูกทิ้ง ไม่ใช่เอามาใช้เงียบๆ
_old = {**MARKET, "prices": {**MARKET["prices"],
        "KBANK": {"price": 158.5, "ccy": "THB", "updated": _D(300)}}}
_pp = LN.pipeline_prices_thb(_old, 33.25)
assert "KBANK" not in _pp, "ราคาเก่ากว่า 12 วันต้องถูกทิ้ง"

# ราคาค้าง (stale) ต้องแพ้ชีตที่มีค่าจริง
_st = {**MARKET, "prices": {**MARKET["prices"],
       "BNB": {"price": 900, "ccy": "USD", "updated": _D(10)}}}   # ค้าง 10 วัน
_p, _s, _d = LN.resolve_prices(_st, LN.parse_live_prices(PRICE_ROWS), 33.25)
assert _s["BNB"] == "sheet", f"ราคาค้างไม่ควรชนะชีต (ได้ {_s['BNB']})"
# ══ ยามกันหน่วยเพี้ยน — เคส PF4103 ที่เจอจริง ═══════════════════════
# ชีตเก็บ Current_Price = มูลค่ารวมทั้งกอง (96,989.07) ไม่ใช่ NAV ต่อหน่วย
# พอคูณจำนวนหน่วย 91,835 ได้ ฿8.9 พันล้าน แล้วส่งออกไปเหมือนเป็นความจริง
_BAD_ROWS = ROWS + [
    ["2026-05-01", "Buy", "PFX", "Provident_Fund", "—", "KTAM", 1, 91835, 1, 0, 96989],
]
_BAD_PX = PRICE_ROWS + [["PFX", 96989.07, "Active"]]
_bad = LN.build_portfolio(_BAD_ROWS, MARKET, _BAD_PX)
_sus = {s["ticker"] for s in _bad["suspect"]}
assert "PFX" in _sus, f"ยามไม่จับ PF4103 แบบผิดหน่วย: {_bad['suspect']}"
assert "PFX" not in _bad["holdings"], "ตัวต้องสงสัยยังอยู่ในพอร์ต"
assert _bad["total"] < 1e9, f"ยอดรวมยังปนค่าผิด: {_bad['total']:,.0f}"
# ยอดรวมต้องเท่ากับกรณีปกติเป๊ะ — การกันออกต้องไม่กระทบตัวอื่น
near(_bad["total"], port["total"], tol=1.0)
assert "กองทุนสำรองฯ" in _bad["groups"], "PF4103 ปกติต้องยังอยู่ ไม่ถูกลบทั้งกลุ่ม"

# กำไร 20 เท่า (คริปโตขาขึ้นจริง) ต้องไม่ถูกกันออก
_ok_rows = ROWS + [
    ["2026-01-01", "Buy", "MOON", "Cryptocurrency", "—", "bitkub", 1, 100, 10, 0, 1000],
]
_ok_px = PRICE_ROWS + [["MOON", 200, "Active"]]     # 100×200 = 20,000 = 20 เท่า
_ok = LN.build_portfolio(_ok_rows, MARKET, _ok_px)
assert not any(s["ticker"] == "MOON" for s in _ok["suspect"]), \
    "กำไร 20 เท่าไม่ควรถูกกันออก — ยามเข้มเกินไป"
assert "MOON" in _ok["holdings"]
print("✓ ยามจับราคาผิดหน่วยได้ และไม่จับกำไรจริงผิด")

assert port["holdings"]["Gold"]["group"] == "ทอง"
near(port["dividends"], 4200)

# ปันผลต้องไม่เปลี่ยนจำนวนหุ้น (SIGN=0)  1000 ซื้อ − 300 ขาย = 700 ตามด้านบน
print("✓ ตัวเลขทุกข้อตรง")

# ── ข้อความ ─────────────────────────────────────────────────────────
print("\n═══ daily (ครั้งแรก ยังไม่มีฐานเทียบ) ═══")
print(LN.daily_message(port, MARKET, {}))

prev = {"total": port["total"] * 0.97,
        "groups": {k: {"value": v["value"] * 0.97} for k, v in port["groups"].items()},
        # state เก็บ [ราคาสกุลเดิม, สกุล] — ต้องมีสกุลกำกับ ไม่งั้นเทียบข้ามสกุลได้
        "prices": {"AAPL": [249.0, "USD"], "KBANK": [157.0, "THB"],
                   "BTC": [108000.0, "USD"], "Gold": [4425.0, "USD"],
                   "BNB": [30800.0, "THB"], "PF4103": [13.44, "THB"]}}

print("\n═══ daily (มีฐานเทียบ) ═══")
print(LN.daily_message(port, MARKET, prev))

mv = LN.movers(port, prev)
print(f"\n═══ movers = {[(t, round(c,2)) for t,c,_ in mv]} ═══")
# AAPL 265/249 = +6.4% (เกิน 5) · BTC 118500/108000 = +9.7% (เกิน 8)
# KBANK +0.96% · Gold +0.11% → ต้องไม่ติด
names = {t for t, _, _ in mv}
assert names == {"AAPL", "BTC"}, f"movers ผิด: {names}"
print(LN.alert_message(mv, port))

# ══ เทียบข้ามสกุลต้องไม่เกิด — เคสที่เกือบส่ง alert ปลอม −97% ═══════
# BNB รอบก่อนราคามาจากชีต (บาท) รอบนี้ Yahoo กลับมา (USD)
# ราคาไม่ได้ขยับเลย แต่ 900/30800 − 1 = −97% ถ้าเทียบข้ามสกุล
_M_usd = {**MARKET, "prices": {**MARKET["prices"],
          "BNB": {"price": 900.0, "ccy": "USD", "updated": _D(0)}}}
_p_usd = LN.build_portfolio(ROWS, _M_usd, PRICE_ROWS)
assert _p_usd["holdings"]["BNB"]["ccy"] == "USD", "ควรใช้ pipeline (USD) รอบนี้"
_mv_x = LN.movers(_p_usd, {"prices": {"BNB": [30800.0, "THB"]}})
assert not _mv_x, f"เทียบข้ามสกุลแล้วได้ mover ปลอม: {_mv_x}"

# สกุลเดียวกันต้องยังเทียบได้ตามปกติ
_mv_ok = LN.movers(_p_usd, {"prices": {"BNB": [800.0, "USD"]}})
assert {t for t, _, _ in _mv_ok} == {"BNB"}, f"สกุลตรงกันแต่ไม่เทียบ: {_mv_ok}"

# state รูปแบบเก่า (ตัวเลขเปล่า ไม่รู้สกุล) ต้องข้าม ไม่ใช่เดา
assert not LN.movers(_p_usd, {"prices": {"BNB": 800.0}}), "state เก่าไม่ควรถูกเทียบ"
print("✓ ไม่เทียบราคาข้ามสกุล (กัน alert ปลอมตอนที่มาของราคาสลับ)")

# ══ ไม่มี USDTHB → ต้องข้ามตัว USD ไม่ใช่เดาอัตรา ═════════════════
_M_nofx = {**MARKET, "data": {k: v for k, v in MARKET["data"].items() if k != "USDTHB"}}
_p_nofx = LN.build_portfolio(ROWS, _M_nofx, PRICE_ROWS)
assert "AAPL" in _p_nofx["missing"], "ไม่มี FX แต่ AAPL ยังถูกตีราคา = เดาอัตรา"
assert "KBANK" in _p_nofx["holdings"], "ตัว THB ต้องยังใช้ได้"
assert "PF4103" in _p_nofx["holdings"], "ราคาจากชีต (บาท) ต้องไม่ถูกกระทบ"
print("✓ ไม่มี FX → ข้ามเฉพาะตัว USD (ตรงกับ shared.js) ไม่เดา 32.0")

# ══ แถวที่วันที่ใช้ไม่ได้ ต้องถูกข้ามเหมือน index.html ════════════
_R_baddate = ROWS + [
    ["", "Buy", "BNB", "Cryptocurrency", "—", "bitkub", 1, 2, 30000, 0, 60000],
    ["#N/A", "Buy", "BNB", "Cryptocurrency", "—", "bitkub", 1, 5, 30000, 0, 150000],
]
_p_bd = LN.build_portfolio(_R_baddate, MARKET, PRICE_ROWS)
near(_p_bd["holdings"]["BNB"]["qty"], 2)      # ไม่ใช่ 9
assert _p_bd["total"] == port["total"], "แถววันที่พังไม่ควรกระทบยอดรวม"
# แต่รูปแบบวันที่ที่ชีตใช้จริงต้องอ่านได้ ไม่ใช่ถูกทิ้งไปด้วย
for _fmt in ("13-Sep-2026", "2026-09-13", "13/09/2026"):
    assert LN.parse_date(_fmt) is not None, f"อ่านวันที่ {_fmt} ไม่ได้"
assert LN.parse_date(46000) is not None, "Google serial อ่านไม่ได้"
assert LN.parse_date("") is None and LN.parse_date("#N/A") is None
print("✓ ข้ามแถววันที่พัง แต่ยังอ่านรูปแบบที่ชีตใช้จริงได้ครบ")


print("\n═══ weekly ═══")
wk = LN.period_message(port, MARKET, prev, "รายสัปดาห์")
print(wk)
# ถือแค่ 4 ตัว หัว-ท้าย 3 ต้องไม่ทับกัน และห้ามมีลูกศรลงบนตัวเลขบวก
for _ln in wk.splitlines():
    if "▼" in _ln:
        assert "−" in _ln, f"ลูกศรลงบนตัวเลขบวก: {_ln!r}"
    if "▲" in _ln:
        assert "+" in _ln, f"ลูกศรขึ้นบนตัวเลขลบ: {_ln!r}"
# ── ตรวจการทับซ้อนจริง ต้องใช้กรณีที่มี "ทั้งขึ้นและลง" ──────────────
# เดิมเช็คบน `wk` ที่ทุกตัวขึ้น → ไม่มีหัวข้อ "แย่สุด" → _best เป็น "" เสมอ
# → `_tk in ""` เป็นเท็จเสมอ → assert ผ่านโดยไม่ได้ตรวจอะไรเลย
# regression ที่ตั้งใจกัน (ถือ 4 ตัว หัว 3 ท้าย 3 ทับกัน) จึงไม่เคยถูกทดสอบ
_prev_mix = dict(prev, prices={
    "AAPL": [249.0, "USD"],    # +6.4%  ขึ้น
    "KBANK": [157.0, "THB"],   # +0.96% ขึ้น
    "BTC": [108000.0, "USD"],  # +9.7%  ขึ้น
    "Gold": [4600.0, "USD"],   # −3.7%  ลง  ← ทำให้มีทั้งสองหัวข้อ
    "BNB": [30800.0, "THB"], "PF4103": [13.44, "THB"]})
_wk_mix = LN.period_message(port, MARKET, _prev_mix, "รายสัปดาห์")
assert "ดีสุด" in _wk_mix and "แย่สุด" in _wk_mix, "กรณีทดสอบไม่ได้มีทั้งสองหัวข้อ"
_up_sec = _wk_mix.split("ดีสุด")[1].split("แย่สุด")[0]
_dn_sec = _wk_mix.split("แย่สุด")[1]
_dup = [t for t in ("AAPL", "KBANK", "BTC", "Gold", "BNB", "PF4103")
        if t in _up_sec and t in _dn_sec]
assert not _dup, f"ตัวเดียวกันโผล่ทั้งดีสุดและแย่สุด: {_dup}"
assert "Gold" in _dn_sec and "Gold" not in _up_sec, "ตัวที่ลงต้องอยู่แย่สุดเท่านั้น"
assert "BTC" in _up_sec and "BTC" not in _dn_sec, "ตัวที่ขึ้นต้องอยู่ดีสุดเท่านั้น"

# กรณีทุกตัวขึ้น → ต้องไม่มีหัวข้อ "แย่สุด" เลย
assert "แย่สุด" not in wk, "ทุกตัวราคาขึ้น แต่ยังโชว์หัวข้อแย่สุด"

# กรณีมีตัวติดลบจริง → ต้องโชว์
_prev2 = dict(prev, prices={**prev["prices"],
                            "Gold": [4800.0, "USD"], "KBANK": [200.0, "THB"]})
wk2 = LN.period_message(port, MARKET, _prev2, "รายสัปดาห์")
assert "แย่สุด" in wk2 and "Gold" in wk2.split("แย่สุด")[1]
print("✓ ดีสุด/แย่สุด แยกตามเครื่องหมาย ไม่ทับกัน")

print("\n═══ ตรวจว่าไม่ส่งข้อความเปล่า ═══")
assert LN.broadcast("", dry=True) is False
assert LN.broadcast("   \n  ", dry=True) is False
print("✓ ข้อความเปล่าไม่ถูกส่ง")

print("\n═══ ความยาวข้อความ ═══")
for name, msg in [("daily", LN.daily_message(port, MARKET, prev)),
                  ("alert", LN.alert_message(mv, port)),
                  ("weekly", LN.period_message(port, MARKET, prev, "รายสัปดาห์"))]:
    print(f"  {name:<8} {len(msg):>4} ตัวอักษร  ({'OK' if len(msg) < 4900 else 'ยาวเกิน'})")

print("\n✅ ผ่านทั้งหมด")
