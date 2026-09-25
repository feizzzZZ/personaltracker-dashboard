#!/usr/bin/env python3
"""v57 — ทดสอบ Monthly report ของ line_notify.py (ไม่ยิง LINE)

ตรวจว่า parse_transactions/month_summary ให้ผลเดียวกับหน้าเว็บ
(computeSummary + savingFromSummary) บนชีตที่มีโครงเหมือนของจริง
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("MARKET_DATA_OUT", "/tmp/t-market.json")
os.environ.setdefault("NOTIFY_STATE", "/tmp/t-state.json")
import line_notify as LN                                            # noqa: E402

fails = 0


def ok(cond, msg):
    global fails
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        fails += 1


def ser(d):   # Google serial date
    return (d - datetime(1970, 1, 1).date()).days + 25569


mk = LN.prev_month_key(LN.NOW)
y, m = int(mk[:4]), int(mk[5:])
d0 = datetime(y, m, 1).date()
pm = LN.prev_month_key(datetime(y, m, 1, tzinfo=LN.TZ))
p0 = datetime(int(pm[:4]), int(pm[5:]), 1).date()

RAW = [
    ["", "", "", "", "", "", "Account #", "Account #", "Credit Card #"],
    ["", "", "", "", "", "", "SCB Bank", "Kasikorn Bank", "SCB Up2ME Credit Card"],
    ["", "", "", "", "", "", 15000, 42000, -35000],
    [],
    ["Date", "Transactions", "Type", "Details", "", "", "SCB_Bank", "KBank", "Card"],
    # เดือนที่รายงาน
    [ser(d0 + timedelta(1)), "Income", "Salary", "Company", None, None, 50000, 0, 0],
    [ser(d0 + timedelta(2)), "Expense", "Food", "Lotus", None, None, -3000, 0, 0],
    [ser(d0 + timedelta(3)), "Bills", "Electric", "MEA", None, None, -1500, 0, 0],
    [ser(d0 + timedelta(4)), "Debt", "Subscription", "Claude AI", None, None, 0, 0, -2000],
    # จ่ายบัตร: ธนาคาร −4,000 / บัตร +4,000 → หักล้างกันเอง ไม่เป็นรายจ่าย
    [ser(d0 + timedelta(5)), "Debt", "Card payment", "Pay card", None, None, -4000, 0, 4000],
    [ser(d0 + timedelta(6)), "Savings", "Invest", "DCA", None, None, 0, -10000, 0],
    [ser(d0 + timedelta(7)), "Expense", "Food", "Grab", None, None, "-500", 0, 0],
    ["ไม่ใช่วันที่", "Expense", "Food", "ร่าง", None, None, -999, 0, 0],   # ต้องถูกข้าม
    [ser(d0 + timedelta(8)), "Expense", "Refund", "คืนเงิน", None, None, 300, 0, 0],
    # เดือนก่อนหน้า
    [ser(p0 + timedelta(2)), "Income", "Salary", "Company", None, None, 50000, 0, 0],
    [ser(p0 + timedelta(3)), "Expense", "Food", "Lotus", None, None, -5000, 0, 0],
]

print("═══ parse_transactions ═══")
tx = LN.parse_transactions(RAW)
ok(len(tx) == 10, f"อ่านได้ 10 รายการ (ข้ามแถววันที่เสีย) — ได้ {len(tx)}")
ok(all(r["month"] in (mk, pm) for r in tx), "เดือนถูกต้อง")

print("═══ month_summary (ต้องตรงกับ computeSummary + savingFromSummary) ═══")
s = LN.month_summary(tx, mk)
ok(s["income"] == 50000, f"income 50,000 — ได้ {s['income']}")
ok(s["expense"] == -4700, f"expense −3,000 −1,500 −500 +300 = −4,700 — ได้ {s['expense']}")
ok(s["debt"] == -2000, f"debt −2,000 (จ่ายบัตรหักล้างกัน) — ได้ {s['debt']}")
ok(s["savings"] == -10000, f"savings −10,000 — ได้ {s['savings']}")
ok(abs(s["sav_rate"] - (50000 - 6700) / 50000 * 100) < 1e-9,
   f"saving rate = (50,000 − 6,700) ÷ 50,000 = 86.6% — ได้ {s['sav_rate']:.1f}%")
ok(s["top"][0][0] == "Food" and s["top"][0][1] == 3500, f"หมวดสูงสุด Food ฿3,500 — ได้ {s['top'][0]}")
ok(all(c != "Refund" for c, _ in s["top"]), "เงินคืนไม่ถูกนับเป็นหมวดใช้จ่าย")

print("═══ monthly_report ═══")
msg = LN.monthly_report(None, {}, {}, tx)
print("─" * 40 + "\n" + msg + "\n" + "─" * 40)
ok(LN.month_label(mk) in msg.splitlines()[0], "หัวข้อระบุเดือนที่รายงาน")
ok("Saving rate 87%" in msg, "มี Saving rate นิยามเดียวกับหน้าเว็บ")
ok("ลดลง" in msg or "เพิ่มขึ้น" in msg, "เทียบรายจ่ายกับเดือนก่อน")
ok("ยังอ่านพอร์ตไม่ได้" in msg, "ไม่มีพอร์ต → บอกตรง ๆ ไม่พัง")
ok(len(msg) < 4900, f"ยาวไม่เกินขีดจำกัด LINE ({len(msg)} ตัวอักษร)")
# พร้อมพอร์ต — ส่วนพอร์ตต้องต่อท้ายโดยไม่มีหัวข้อซ้ำ
_today = LN.NOW.date().isoformat()
MK = {"data": {"USDTHB": {"value": 33.0}},
      "prices": {"KBANK": {"price": 160.0, "ccy": "THB", "updated": _today}}}
PR = [["Date", "Transaction_Type", "Ticker", "Asset_Type", "Industry", "Platform",
       "FX_Rate", "Quantity", "Price", "Commission_THB", "Total_Amount_THB"],
      ["2026-02-10", "Buy", "KBANK", "Thai_Stock", "Bank", "SCBS", 1, 100, 150, 0, 15000]]
port = LN.build_portfolio(PR, MK, [])
msg3 = LN.monthly_report(port, MK, {"total": 15500, "prices": {}, "groups": {}}, tx)
print(msg3.split("💼")[1])
ok("💼 พอร์ตลงทุน" in msg3 and "มูลค่ารวม ฿16,000" in msg3, "ต่อส่วนพอร์ตได้")
ok(msg3.count("🗓") == 1, "หัวข้อไม่ซ้ำ")
msg2 = LN.monthly_report(None, {}, {}, [])
ok("อ่านชีต Transaction ไม่ได้" in msg2, "อ่าน Transaction ไม่ได้ → บอกเหตุผล")

print("─" * 40)
print("✅ ผ่านทั้งหมด" if not fails else f"❌ ไม่ผ่าน {fails} ข้อ")
sys.exit(1 if fails else 0)
