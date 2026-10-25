#!/usr/bin/env python3
"""
ทดสอบ scripts/bot_paper.py + บล็อก watchlist ของ fetch_signals.py  (v59)
────────────────────────────────────────────────────────────────────────
ไม่ต่อเน็ตเลย — สร้างราคาสังเคราะห์ 2 ปีที่มีทั้งขาขึ้น ตลาดพัง และฟื้นตัว
แล้วเดิน bot วันต่อวันเหมือนที่ GitHub Actions ทำ

ทำไมต้องเดินทีละวันจริง ๆ แทนที่จะ assert ฟังก์ชันเดี่ยว ๆ:
  บั๊กของระบบที่มี state สะสม (เงินสด · จำนวนหน่วย · ต้นทุน) แทบไม่เคยโผล่
  ในการเรียกครั้งเดียว มันโผล่ตอนวันที่ 200 หลังจากขายบางส่วนไปแล้วสองรอบ
  — ซึ่งเป็นบั๊กเดียวกับที่ v50 เจอใน shared.js (ต้นทุนหลังขายบางส่วน)

รัน:  python3 claude/test_bot_paper.py
"""
import json
import math
import os
import random
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

FAIL = []
NCHECK = 0


def ck(cond, msg):
    global NCHECK
    NCHECK += 1
    if not cond:
        FAIL.append(msg)
        print(f"  ✗ {msg}")
    return cond


# ══════════════════════════════════════════════════════════════════════
# ราคาสังเคราะห์ — จงใจใส่ช่วงที่ตลาดพัง ไม่ใช่ขาขึ้นอย่างเดียว
# ══════════════════════════════════════════════════════════════════════
# กฎหลักของ bot คือ "ต่ำกว่า MA200 ห้ามซื้อ" ซึ่งไม่มีทางถูกทดสอบเลย
# ถ้าข้อมูลทดสอบขึ้นตลอด — จะได้ CI ที่เขียวโดยไม่เคยแตะกฎที่สำคัญที่สุด
def series(n, start, drift, vol, crash_at=None, crash_pct=-0.45, seed=1):
    rnd = random.Random(seed)
    out, p = [], start
    for i in range(n):
        p *= math.exp(drift + vol * rnd.gauss(0, 1))
        if crash_at and crash_at <= i < crash_at + 60:
            p *= math.exp(crash_pct / 60)
        out.append(round(p, 4))
    return out


def build_md(fs, day_idx, dates, prices):
    """สร้าง market-data.json ของวันนั้น ด้วย build_signal() ตัวจริงจาก pipeline"""
    wl = {}
    for key, (sym, name, cat) in prices.items():
        v = SERIES[key][: day_idx + 1]
        d = dates[: day_idx + 1]
        if len(v) < 30:
            continue
        e = fs.build_signal(sym, d, v, "watch")
        e["name"] = name
        e["cat"] = cat
        wl[key] = e
    return {"generated_at": dates[day_idx], "data": {
        "USDTHB": {"value": 33.4, "updated": dates[day_idx]}},
        "watchlist": wl, "signals": {}, "prices": {}}


DAYS = 730
D0 = datetime(2024, 1, 1, tzinfo=timezone.utc)
DATES = [(D0 + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(DAYS)]
UNI = {
    "GLD":     ("GLD", "ทองคำ (GLD)", "gold"),
    "GDX":     ("GDX", "หุ้นเหมืองทอง (GDX)", "gold"),
    "BTC-USD": ("BTC-USD", "Bitcoin", "crypto"),
}
SERIES = {
    "GLD":     series(DAYS, 180, 0.00030, 0.008, crash_at=430, crash_pct=-0.25, seed=11),
    "GDX":     series(DAYS, 30, 0.00040, 0.017, crash_at=400, crash_pct=-0.50, seed=22),
    "BTC-USD": series(DAYS, 42000, 0.00080, 0.030, crash_at=380, crash_pct=-0.55, seed=33),
}


def main():
    import fetch_signals as fs

    print("── 1. ฟังก์ชันบริสุทธิ์ของ pipeline ─────────")
    ck(len(fs.WATCHLIST) == 25, "WATCHLIST ต้องมี 25 ตัว")
    ck(len({k for k, *_ in fs.WATCHLIST}) == 25, "key ใน WATCHLIST ต้องไม่ซ้ำ")
    ck(len({s for _, s, _, _ in fs.WATCHLIST}) == 25, "symbol ใน WATCHLIST ต้องไม่ซ้ำ")
    ck(all(c in fs.WATCH_CATS for _, _, _, c in fs.WATCHLIST),
       "ทุกตัวต้องมีหมวดที่ประกาศไว้ใน WATCH_CATS")
    for need in ("GLD", "GDX", "BTC-USD"):
        ck(any(k == need for k, *_ in fs.WATCHLIST),
           f"{need} ต้องอยู่ใน WATCHLIST — bot อ่านราคาจากบล็อกนี้")

    v = SERIES["GLD"]
    e = fs.build_signal("GLD", DATES, v, "watch")
    ck("score" not in e, "ต้องไม่มี field `score` แล้ว — คะแนนรวมคือบั๊กที่ v60 ถอดทิ้ง")
    for f in ("mom12_1", "gate", "gate_why", "rank", "size", "size_why"):
        ck(f in e, f"build_signal ต้องส่ง {f}")
    ck(e["gate"] == fs.gate_of(v[-1] > fs.sma(v, 200), fs.mom12_1(v))[0],
       "gate ใน build_signal ต้องตรงกับ gate_of() ที่เรียกตรง ๆ")
    ck(0.5 <= e["size"] <= 1.5, f"ขนาดไม้ต้องอยู่ใน 0.5–1.5 — ได้ {e['size']}")
    ck(len(e["spark"]) <= 26, "spark ต้องไม่เกิน 26 จุด")

    # โมเมนตัม 12-1 ต้องตัดเดือนล่าสุดจริง ๆ
    ck(fs.mom12_1(v[:252]) is None, "ประวัติไม่ถึง 253 วัน ต้องคืน None")
    up = [100 * (1.001 ** i) for i in range(300)]
    ck(fs.mom12_1(up) > 0, "ราคาขึ้นตลอด โมเมนตัมต้องเป็นบวก")
    spike = up[:]; spike[-21:] = [1e6] * 21      # พุ่งเฉพาะเดือนล่าสุด
    ck(abs(fs.mom12_1(spike) - fs.mom12_1(up)) < 1e-9,
       "ราคาที่พุ่งเฉพาะเดือนล่าสุด ต้องไม่กระทบโมเมนตัม 12-1 เลย")

    print("── 1b. ประตู · อันดับ · ขนาดไม้ ─────────────")
    BUY = {"ทยอยเข้าเพิ่ม", "เข้าได้ตามแผน", "เข้าได้ ลดขนาดไม้"}
    NOBUY = {"ไม่เข้า — รอเทรนด์กลับ", "ข้อมูลไม่พอตัดสิน"}
    ck(not (BUY & NOBUY), "ชุดป้าย \"ซื้อได้\" กับ \"ไม่ซื้อ\" ต้องไม่ทับกันเลย")

    # ไล่ทุกคู่ที่เป็นไปได้: ป้ายต้องเป็นฟังก์ชันของ (ประตู, ขนาดไม้) เท่านั้น
    # และของที่ไม่ผ่านประตู ห้ามได้ป้ายที่แปลว่าซื้อได้ ไม่ว่าจะถูกแค่ไหน
    leak, seen = [], {}
    for tu in (True, False, None):
        for mom in (-50, -0.1, 0, 0.1, 30, None):
            for rsi in (5, 25, 29, 44, 50, 61, 70, 80, 95, None):
                for dd in (0, -0.5, -5, -12, -25, -60, None):
                    for pos in (0, 10, 15, 50, 94, 95, 100, None):
                        g, _ = fs.gate_of(tu, mom)
                        sz, _ = fs.size_mult(rsi, dd, pos)
                        lb = fs.label_of(g, sz)
                        if g != "pass" and lb in BUY:
                            leak.append((tu, mom, rsi, dd, pos, lb))
                        ck2 = seen.setdefault(lb, set())
                        ck2.add(g)
                        if not (0.5 <= sz <= 1.5):
                            leak.append(("size", rsi, dd, pos, sz))
    ck(not leak, f"ไม่ผ่านประตูแต่ได้ป้ายซื้อได้ {len(leak)} กรณี เช่น {leak[:2]}")
    shared = {lb: gs for lb, gs in seen.items() if len(gs) > 1}
    ck(not shared, f"ป้ายที่ใช้ร่วมกันข้ามสถานะประตู (ห้ามมี): {shared}")

    # ── regression ตรงกับอาการที่ผู้ใช้รายงานจริง (ข้อมูล 27 ก.ย. 2026) ──
    # AAPL อยู่ที่จุดสูงสุดรอบปี +20.2% ใน 3 เดือน  vs  MINT หลุด MA200 −12.6%
    # รุ่นเก่าให้ป้ายเดียวกันทั้งคู่ ("ชะลอเข้าเพิ่ม") และ AAPL ได้คะแนนแย่กว่า
    g_a, _ = fs.gate_of(True, 25.0)
    s_a, _ = fs.size_mult(65.7, 0.0, 100.0)
    lab_a = fs.label_of(g_a, s_a)
    g_m, _ = fs.gate_of(False, -15.0)
    s_m, _ = fs.size_mult(40.5, -19.3, 25.9)
    lab_m = fs.label_of(g_m, s_m)
    ck(g_a == "pass" and g_m == "fail",
       f"AAPL ต้องผ่านประตู · MINT ต้องไม่ผ่าน — ได้ {g_a}/{g_m}")
    ck(lab_a != lab_m, f"สองเคสนี้ต้องไม่ได้ป้ายเดียวกันอีก — ได้ {lab_a!r} กับ {lab_m!r}")
    ck(lab_a in BUY, f"ของที่จุดสูงสุดในเทรนด์ขาขึ้นต้องซื้อได้ — ได้ {lab_a!r}")
    ck(s_a < 1.0, f"แต่ขนาดไม้ต้องเล็กลงเพราะแพง — ได้ ×{s_a}")

    # อันดับต้องปรับด้วยความผันผวน
    ck(fs.rank_of(40, 10) > fs.rank_of(60, 30),
       "ขึ้น 40% แบบนิ่ง ต้องได้อันดับดีกว่าขึ้น 60% แบบเหวี่ยง")
    ck(fs.rank_of(None, 10) is None and fs.rank_of(10, None) is None,
       "ข้อมูลไม่ครบ อันดับต้องเป็น None ไม่ใช่ 0")

    print("── 2. กฎการตัดสินใจของ bot (pure) ──────────")
    import bot_paper as bp

    cases = [
        ({"gate": "fail", "size": 1.5}, 100, 500, "hold", "ไม่ผ่านประตู + ไม้ใหญ่สุด ต้องไม่ซื้อ"),
        ({"gate": "fail", "size": 1.5}, 0, 500, "hold", "ไม่ผ่านประตู + ไม่ได้ถือ ต้องอยู่เฉย"),
        ({"gate": "fail", "size": 0.7}, 400, 500, "sell", "ไม่ผ่านประตู + ยังแพง ต้องลดน้ำหนัก"),
        ({"gate": "fail", "size": 1.4}, 400, 500, "hold", "ไม่ผ่านประตูแต่ถูกมากแล้ว ต้องไม่ขายที่จุดต่ำ"),
        ({"gate": "pass", "size": 1.4}, 100, 500, "buy", "ผ่านประตู + ย่อ ต้องซื้อ"),
        ({"gate": "pass", "size": 1.0}, 100, 500, "buy", "ผ่านประตู + กลาง ๆ ต้องซื้อตามปกติ"),
        ({"gate": "pass", "size": 0.5}, 100, 500, "buy", "ผ่านประตู + แพง ยังซื้อได้แต่น้อย"),
        ({"gate": "pass", "size": 1.0}, 500, 500, "hold", "อยู่ที่เป้าพอดี ไม่ต้องทำอะไร"),
        ({"gate": "pass", "size": 0.6}, 700, 500, "sell", "เกินเป้า 40% + แพง ต้องขายกลับมาที่เป้า"),
        ({"gate": "pass", "size": 1.4}, 700, 500, "hold", "เกินเป้าแต่ยังถูก ไม่ต้องรีบขาย"),
        ({"gate": "unknown", "size": 1.0}, 0, 500, "buy", "ยังไม่รู้เทรนด์ ยังซื้อได้ (ไม่รู้ ≠ แย่)"),
    ]
    for sig, cur, tgt, want, msg in cases:
        act, frac, _ = bp.decide(sig, cur, tgt)
        ck(act == want, f"{msg} — ได้ {act}")
        ck(0.0 <= frac <= 1.0, f"fraction ต้องอยู่ใน 0..1 ({msg}) — ได้ {frac}")
    ck(bp.decide({"gate": "pass", "size": 1.5}, 0, 500)[1] > bp.decide(
        {"gate": "pass", "size": 1.0}, 0, 500)[1], "ไม้ใหญ่ต้องซื้อแรงกว่าไม้ปกติ")
    ck(bp.decide({"gate": "pass", "size": 0.5}, 0, 500)[1] < bp.decide(
        {"gate": "pass", "size": 1.0}, 0, 500)[1], "ไม้เล็กต้องซื้อน้อยกว่าไม้ปกติ")
    ck(bp.decide({"gate": "unknown", "size": 1.0}, 0, 500)[1] < bp.decide(
        {"gate": "pass", "size": 1.0}, 0, 500)[1],
       "ยังไม่รู้เทรนด์ ต้องเข้าน้อยกว่าตัวที่ผ่านประตูแล้ว")
    # ขนาดไม้ต้องพลิกประตูไม่ได้ ไม่ว่าจะยัดค่าอะไรเข้าไป
    for bad_size in (0, -5, 99, None, "1.5"):
        act, _, _ = bp.decide({"gate": "fail", "size": bad_size}, 0, 500)
        ck(act != "buy", f"ไม่ผ่านประตูแต่ซื้อ เมื่อ size={bad_size!r}")
    # ไม่มี gate เลย (แถว carry จาก pipeline รุ่นเก่า) ต้องไม่ถูกตีเป็น pass
    ck(bp.decide({}, 0, 500)[0] == "buy", "ไม่มี gate ถือเป็น unknown — ซื้อได้ครึ่งไม้")
    ck(bp.decide({}, 0, 500)[1] <= bp.CFG["aggression"]["unknown"] * 1.5 + 1e-9,
       "ไม่มี gate ต้องใช้ระดับ unknown ไม่ใช่ระดับ pass")
    ck(bp.fee_for(10, "etf") == bp.CFG["fee_min_usd_etf"],
       "คำสั่ง ETF เล็ก ๆ ต้องโดนค่าคอมขั้นต่ำ")
    ck(bp.fee_for(10, "crypto") < 0.1, "คริปโตไม่มีค่าคอมขั้นต่ำ")
    ck(bp.max_drawdown([1, 1.2, 0.9, 1.1]) == -25.0, "max_drawdown จาก 1.2 ลง 0.9 = −25%")
    ck(bp.max_drawdown([1, 1.1, 1.2]) == 0.0, "ขึ้นอย่างเดียว drawdown = 0")

    print("── 3. เดินพอร์ตจริง 730 วัน ────────────────")
    tmp = tempfile.mkdtemp(prefix="botsim-")
    md_p, out_p = os.path.join(tmp, "market-data.json"), os.path.join(tmp, "bot-paper.json")
    bp.MD, bp.OUT = md_p, out_p

    buys_below, sells_bench, neg_cash, drift = [], 0, [], []
    # 253 วันคือขั้นต่ำของโมเมนตัม 12-1 — เริ่มที่ 300 เพื่อให้ประตูทำงานจริง
    # ถ้าเริ่มเร็วกว่านี้ ทุกตัวจะเป็น "ยังไม่รู้" แล้วกฎที่สำคัญที่สุดไม่ถูกทดสอบเลย
    start = 300
    for i in range(start, DAYS):
        day = DATES[i]
        with open(md_p, "w", encoding="utf-8") as f:
            json.dump(build_md(fs, i, DATES, UNI), f)
        bp.NOW = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        bp.TODAY, bp.MONTH = day, day[:7]
        bp.FETCHED_AT = bp.NOW.isoformat()
        sys.stdout = open(os.devnull, "w")
        try:
            rc = bp.main()
        finally:
            sys.stdout.close()
            sys.stdout = sys.__stdout__
        if rc != 0:
            ck(False, f"bot_paper.main() คืน {rc} ที่วัน {day}")
            break

        st = json.load(open(out_p, encoding="utf-8"))
        px = {k: st["stats"]["bot"]["positions"] for k in ()}  # noqa: F841
        live = {k: SERIES[k][i] for k in UNI}

        # (a) เงินสดห้ามติดลบ — ถ้าติดลบแปลว่ายืมเงินมาซื้อ ซึ่งไม่ใช่กติกา
        for b in ("bot", "bench"):
            if st[b]["cash"] < -1e-6:
                neg_cash.append((day, b, st[b]["cash"]))

        # (b) กฎเหล็ก: ห้ามซื้อตอนไม่ผ่านประตู
        wl = json.load(open(md_p, encoding="utf-8"))["watchlist"]
        for t in st["trades"]:
            if t["d"] == day and t["book"] == "bot" and t["side"] == "buy":
                if (wl.get(t["k"]) or {}).get("gate") == "fail":
                    buys_below.append((day, t["k"], (wl.get(t["k"]) or {}).get("gate_why")))

        # (c) พอร์ต DCA ต้องไม่ขายเลยตลอดกาล — มันคือ "การไม่ตัดสินใจ"
        sells_bench = sum(1 for t in st["trades"] if t["book"] == "dca" and t["side"] == "sell")

        # (d) มูลค่าที่รายงาน ต้องเท่ากับเงินสด + Σ(จำนวน × ราคา) เสมอ
        for b in ("bot", "bench"):
            calc = st[b]["cash"] + sum(p["qty"] * live[k] for k, p in st[b]["pos"].items())
            rep = st["stats"][b]["equity"]
            if abs(calc - rep) > 0.02:
                drift.append((day, b, round(calc - rep, 4)))

    st = json.load(open(out_p, encoding="utf-8"))
    s = st["stats"]
    ck(not neg_cash, f"เงินสดติดลบ {len(neg_cash)} วัน เช่น {neg_cash[:2]}")
    ck(not buys_below, f"ซื้อตอนไม่ผ่านประตู {len(buys_below)} ครั้ง เช่น {buys_below[:2]}")
    # สนามทดสอบต้องเคยมีทั้งช่วงผ่านและไม่ผ่าน ไม่งั้นข้อบนไม่ได้ทดสอบอะไร
    gates_seen = set()
    for i2 in range(start, DAYS, 37):
        for _k, (sym, nm, cat) in UNI.items():
            vv = SERIES[_k][: i2 + 1]
            if len(vv) >= 30:
                gates_seen.add(fs.gate_of(
                    None if fs.sma(vv, 200) is None else vv[-1] > fs.sma(vv, 200),
                    fs.mom12_1(vv))[0])
    ck({"pass", "fail"} <= gates_seen,
       f"ราคาทดสอบต้องผ่านทั้งช่วงที่ประตูเปิดและปิด — เจอแค่ {gates_seen}")
    ck(sells_bench == 0, f"พอร์ต DCA ขาย {sells_bench} ครั้ง — ต้องเป็น 0")
    ck(not drift, f"มูลค่าที่รายงานไม่ตรงกับที่คำนวณ {len(drift)} วัน เช่น {drift[:2]}")

    months = len({d[:7] for d in DATES[start:]})
    want_dep = bp.CFG["start_cash_usd"] + bp.CFG["monthly_deposit_usd"] * (months - 1)
    ck(abs(st["deposits"] - want_dep) < 0.01,
       f"เงินเข้ารวมต้องเป็น ${want_dep:,.0f} — ได้ ${st['deposits']:,.0f}")

    # NAV ต้องสอดคล้องกับมูลค่า/จำนวนหน่วย ทั้งสองพอร์ต
    for b in ("bot", "bench"):
        nav = s[b]["equity"] / st[b]["units"]
        ck(abs(nav - s[b]["nav"]) < 1e-4, f"NAV ของ {b} ไม่ตรงกับ equity/units")
    ck(s["bot"]["nav"] > 0 and s["bench"]["nav"] > 0, "NAV ต้องเป็นบวกทั้งคู่")
    ck(abs(s["edge_pp"] - (s["bot"]["nav"] - s["bench"]["nav"]) * 100) < 0.02,
       "edge_pp ต้องเป็นผลต่าง NAV คูณ 100")
    ck(s["bot"]["mdd"] <= 0 and s["bench"]["mdd"] <= 0, "drawdown ต้องไม่เป็นบวก")
    ck(len(st["equity"]) <= bp.CFG["max_equity_days"], "เส้นผลตอบแทนต้องถูกตัดตามเพดาน")
    ck(len(st["trades"]) <= bp.CFG["max_trades_keep"], "ประวัติเทรดต้องถูกตัดตามเพดาน")
    ck(len({r[0] for r in st["equity"]}) == len(st["equity"]),
       "เส้นผลตอบแทนต้องมีวันละจุดเดียว ห้ามซ้ำ")
    ck(s["n_trades"] > 10, f"ควรมีการเทรดเกิดขึ้นจริง — ได้ {s['n_trades']} ครั้ง")
    ck(s["fees_paid"] > 0, "ค่าธรรมเนียมต้องถูกนับ")

    # ── idempotent: รันซ้ำวันเดิมต้องไม่เทรดซ้ำ ─────────────────────
    n_before, dep_before = len(st["trades"]), st["deposits"]
    sys.stdout = open(os.devnull, "w")
    try:
        bp.main()
    finally:
        sys.stdout.close()
        sys.stdout = sys.__stdout__
    st2 = json.load(open(out_p, encoding="utf-8"))
    ck(len(st2["trades"]) == n_before, "รันซ้ำวันเดิมต้องไม่เพิ่มคำสั่ง")
    ck(abs(st2["deposits"] - dep_before) < 1e-9, "รันซ้ำวันเดิมต้องไม่เติมเงินซ้ำ")
    ck(len(st2["equity"]) == len(st["equity"]), "รันซ้ำวันเดิมต้องไม่เพิ่มจุดในเส้น")

    # ── ไม่มี market-data.json = ต้องข้ามอย่างสุภาพ ไม่ใช่พัง ─────────
    os.rename(md_p, md_p + ".bak")
    sys.stdout = open(os.devnull, "w")
    try:
        rc = bp.main()
    finally:
        sys.stdout.close()
        sys.stdout = sys.__stdout__
    ck(rc == 0, "ไม่มี market-data.json ต้องคืน 0 (รอ pipeline) ไม่ใช่ทำ job แดง")
    os.rename(md_p + ".bak", md_p)

    # ── ราคาเก่าเกิน = ต้องไม่เทรดตัวนั้น ──────────────────────────
    md = json.load(open(md_p, encoding="utf-8"))
    md["watchlist"]["GLD"]["updated"] = "2020-01-01"
    json.dump(md, open(md_p, "w", encoding="utf-8"))
    st3 = json.load(open(out_p, encoding="utf-8"))
    st3["last_trade_day"] = None
    # นับคำสั่ง GLD ของวันนี้ที่ "มีอยู่ก่อนแล้ว" จากรอบปกติ — ต้องเทียบส่วนต่าง
    # ไม่ใช่เทียบว่ามีหรือไม่มี ไม่งั้นคำสั่งของรอบก่อนหน้าจะถูกนับเป็นความผิด
    # ของรอบนี้ (การทดสอบที่ fail เพราะตัวเองตั้งคำถามผิด แย่กว่าไม่ทดสอบ)
    gld_before = sum(1 for t in st3["trades"]
                     if t["d"] == bp.TODAY and t["k"] == "GLD" and t["book"] == "bot")
    json.dump(st3, open(out_p, "w", encoding="utf-8"))
    sys.stdout = open(os.devnull, "w")
    try:
        bp.main()
    finally:
        sys.stdout.close()
        sys.stdout = sys.__stdout__
    st4 = json.load(open(out_p, encoding="utf-8"))
    skipped = [x["k"] for x in st4["today"]["skipped"]]
    ck("GLD" in skipped, "ราคาเก่า 6 ปี ต้องถูกข้าม ไม่ใช่เอามาตัดสินใจ")
    gld_after = sum(1 for t in st4["trades"]
                    if t["d"] == bp.TODAY and t["k"] == "GLD" and t["book"] == "bot")
    ck(gld_after == gld_before,
       f"ห้ามเทรดตัวที่ราคาเก่าเกิน — คำสั่ง GLD เพิ่มจาก {gld_before} เป็น {gld_after}")
    ck(st4["stats"]["bot"]["equity"] > 0,
       "ราคาเก่ายังใช้ตีมูลค่าได้ — ห้ามนับเป็น 0 (บทเรียน last-known-price)")

    print("── 4. รูปร่างไฟล์ที่หน้าเว็บต้องใช้ได้ ──────")
    for k in ("schema", "stats", "equity", "trades", "today", "config", "computed_at"):
        ck(k in st4, f"bot-paper.json ต้องมีคีย์ {k}")
    for k in ("bot", "bench", "edge_pp", "days", "n_trades", "fees_paid", "deposits", "usdthb"):
        ck(k in st4["stats"], f"stats ต้องมีคีย์ {k}")
    for k in ("equity", "nav", "ret", "cash", "mdd", "positions"):
        ck(k in st4["stats"]["bot"], f"stats.bot ต้องมีคีย์ {k}")
    ck(all(len(r) == 6 for r in st4["equity"]), "แถวของเส้นผลตอบแทนต้องมี 6 ช่อง")
    size = os.path.getsize(out_p) / 1024
    ck(size < 400, f"bot-paper.json ต้องไม่บวมเกิน 400 KB — ได้ {size:.0f} KB")

    shutil.rmtree(tmp, ignore_errors=True)

    print("─────────────────────────────────────────────")
    print(f"NAV บอท {s['bot']['nav']:.4f} · DCA {s['bench']['nav']:.4f} · "
          f"ส่วนต่าง {s['edge_pp']:+.2f} pp · เทรด {s['n_trades']} ครั้ง · "
          f"drawdown {s['bot']['mdd']}% vs {s['bench']['mdd']}%")
    print(f"ตรวจ {NCHECK} ข้อ · ผ่าน {NCHECK - len(FAIL)} · ตก {len(FAIL)}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
