#!/usr/bin/env python3
"""ทดสอบ line_notify.py ด้วยข้อมูลจำลองที่มี shape เหมือนชีตจริง (ไม่ยิง LINE)"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("MARKET_DATA_OUT", "/tmp/t-market.json")
os.environ.setdefault("NOTIFY_STATE", "/tmp/t-state.json")

MARKET = {
    "generated_at": "2026-09-15T06:30:00+00:00",
    "data": {"USDTHB": {"value": 33.25}, "SET_INDEX": {"value": 1284.55},
             "SP500": {"value": 6712.4}, "VIX": {"value": 15.13}},
    "prices": {
        "AAPL": {"price": 265.0, "ccy": "USD", "updated": "2026-09-14"},
        "KBANK": {"price": 158.5, "ccy": "THB", "updated": "2026-09-14"},
        "BTC": {"price": 118500.0, "ccy": "USD", "updated": "2026-09-15"},
        "Gold": {"price": 4430.0, "ccy": "USD", "updated": "2026-09-14"},
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
assert "TPAC" not in LN.parse_live_prices(PRICE_ROWS)
assert "KBANK" not in LN.parse_live_prices(PRICE_ROWS), "Inactive หลุดเข้ามา"
assert "AAPL" not in LN.parse_live_prices(PRICE_ROWS), "#N/A หลุดเข้ามา"

# ราคาค้างเกิน PRICE_MAX_DAYS ต้องถูกทิ้ง ไม่ใช่เอามาใช้เงียบๆ
_old = {**MARKET, "prices": {**MARKET["prices"],
        "KBANK": {"price": 158.5, "ccy": "THB", "updated": "2026-01-01"}}}
_pp = LN.pipeline_prices_thb(_old, 33.25)
assert "KBANK" not in _pp, "ราคาเก่ากว่า 12 วันต้องถูกทิ้ง"

# ราคาค้าง (stale) ต้องแพ้ชีตที่มีค่าจริง
_st = {**MARKET, "prices": {**MARKET["prices"],
       "BNB": {"price": 900, "ccy": "USD", "updated": "2026-09-08"}}}   # 10 วัน
_p, _s, _d = LN.resolve_prices(_st, LN.parse_live_prices(PRICE_ROWS), 33.25)
assert _s["BNB"] == "sheet", f"ราคาค้างไม่ควรชนะชีต (ได้ {_s['BNB']})"
assert port["holdings"]["Gold"]["group"] == "ทอง"
near(port["dividends"], 4200)

# ปันผลต้องไม่เปลี่ยนจำนวนหุ้น (SIGN=0)  1000 ซื้อ − 300 ขาย = 700 ตามด้านบน
print("✓ ตัวเลขทุกข้อตรง")

# ── ข้อความ ─────────────────────────────────────────────────────────
print("\n═══ daily (ครั้งแรก ยังไม่มีฐานเทียบ) ═══")
print(LN.daily_message(port, MARKET, {}))

prev = {"total": port["total"] * 0.97,
        "groups": {k: {"value": v["value"] * 0.97} for k, v in port["groups"].items()},
        # ราคาสกุลเดิม (native) ไม่ใช่ THB — ตรงกับที่ state เก็บ
        "prices": {"AAPL": 249.0, "KBANK": 157.0, "BTC": 108000.0,
                   "Gold": 4425.0, "BNB": 30800.0, "PF4103": 13.44}}

print("\n═══ daily (มีฐานเทียบ) ═══")
print(LN.daily_message(port, MARKET, prev))

mv = LN.movers(port, prev)
print(f"\n═══ movers = {[(t, round(c,2)) for t,c,_ in mv]} ═══")
# AAPL 265/249 = +6.4% (เกิน 5) · BTC 118500/108000 = +9.7% (เกิน 8)
# KBANK +0.96% · Gold +0.11% → ต้องไม่ติด
names = {t for t, _, _ in mv}
assert names == {"AAPL", "BTC"}, f"movers ผิด: {names}"
print(LN.alert_message(mv, port))

print("\n═══ weekly ═══")
wk = LN.period_message(port, MARKET, prev, "รายสัปดาห์")
print(wk)
# ถือแค่ 4 ตัว หัว-ท้าย 3 ต้องไม่ทับกัน และห้ามมีลูกศรลงบนตัวเลขบวก
for _ln in wk.splitlines():
    if "▼" in _ln:
        assert "−" in _ln, f"ลูกศรลงบนตัวเลขบวก: {_ln!r}"
    if "▲" in _ln:
        assert "+" in _ln, f"ลูกศรขึ้นบนตัวเลขลบ: {_ln!r}"
_best = wk.split("ดีสุด")[1].split("แย่สุด")[0] if "แย่สุด" in wk else ""
for _tk in ("AAPL", "KBANK", "BTC", "Gold"):
    assert not (_tk in _best and _tk in wk.split("แย่สุด")[-1]), \
        f"{_tk} โผล่ทั้งดีสุดและแย่สุด"

# กรณีทุกตัวขึ้น → ต้องไม่มีหัวข้อ "แย่สุด" เลย
assert "แย่สุด" not in wk, "ทุกตัวราคาขึ้น แต่ยังโชว์หัวข้อแย่สุด"

# กรณีมีตัวติดลบจริง → ต้องโชว์
_prev2 = dict(prev, prices={**prev["prices"], "Gold": 4800.0, "KBANK": 200.0})
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
