#!/usr/bin/env python3
"""
Personal Tracker — bot เทรดจำลอง (paper)  v1
────────────────────────────────────────────────────────────────────────
รันต่อจาก fetch_signals.py ในงานเดียวกัน อ่านสัญญาณที่เพิ่งคำนวณเสร็จ
แล้วตัดสินใจ "ซื้อ/ขาย/อยู่เฉย" ของสามสินทรัพย์: ทอง (GLD) · หุ้นเหมืองทอง
(GDX) · Bitcoin  แล้วบันทึกลง bot-paper.json

  ⚠️  ไม่มีการส่งคำสั่งซื้อจริงที่ไหนทั้งสิ้น  ไม่มี API key ของ exchange
      ไม่มี endpoint ที่ยิงออก  ไฟล์นี้เขียนตัวเลขลงไฟล์ JSON อย่างเดียว

ทำไมต้อง paper ก่อน
───────────────────
กฎการเทรดที่ยังไม่มีหลักฐานว่าได้ผล = การเดา  การต่อ API เข้าไปก่อนมีหลักฐาน
แปลว่าเอาเงินจริงไปจ่ายค่าเรียนรู้ ทั้งที่จ่ายด้วยไฟล์ JSON ก็เรียนรู้ได้เหมือนกัน
ไฟล์นี้จึงเก็บสองพอร์ตขนานกันตั้งแต่วันแรก แล้วเทียบกันตรง ๆ:

  BOT   — ซื้อตามสัญญาณ (เทรนด์ + จังหวะ จาก fetch_signals.py)
  DCA   — ซื้อทุกเดือนตามน้ำหนักคงที่ ไม่สนสัญญาณ ไม่เคยขาย

เงินเข้าเท่ากัน วันเดียวกัน ค่าธรรมเนียมเกณฑ์เดียวกัน ต่างกันแค่ "วิธีตัดสินใจ"
คำถามเดียวที่พอร์ตนี้มีหน้าที่ตอบคือ: การจับจังหวะชนะการไม่จับจังหวะไหม
ถ้าคำตอบคือไม่ นั่นคือผลลัพธ์ที่มีค่าที่สุดของทั้งโครงการ — และได้มาฟรี

การวัดผล: NAV ต่อหน่วย ไม่ใช่มูลค่ารวม
────────────────────────────────────────
มูลค่ารวมโตได้เพราะ "เติมเงินเข้าไป" ไม่ใช่เพราะทำได้ดี — ตัวเลขนั้นเทียบกัน
ไม่ได้ถ้าจังหวะเงินเข้าต่างกัน  จึงใช้ระบบหน่วยแบบกองทุน: เงินเข้าซื้อหน่วย
ที่ NAV ปัจจุบัน  NAV จึงเป็นผลตอบแทนล้วน ๆ ที่ไม่ปนกับการเติมเงิน
(นิยามเดียวกับ TWR — ต่างจาก XIRR ที่หน้าพอร์ตใช้วัดผลของ *ผู้ลงทุน*)

รันเอง:  python3 scripts/bot_paper.py
         BOT_RESET=1 python3 scripts/bot_paper.py     # ล้างพอร์ตเริ่มใหม่
stdlib ล้วน ไม่ต่อเน็ต ไม่ใช้ API key
"""
import json
import os
import sys
from datetime import datetime, timezone

MD = os.environ.get("MARKET_DATA_OUT", "market-data.json")
OUT = os.environ.get("BOT_PAPER_OUT", "bot-paper.json")

NOW = datetime.now(timezone.utc)
TODAY = NOW.strftime("%Y-%m-%d")
MONTH = NOW.strftime("%Y-%m")
FETCHED_AT = NOW.isoformat()

# ══════════════════════════════════════════════════════════════════════
# พารามิเตอร์ — เปลี่ยนที่นี่ที่เดียว และถูกเขียนลงไฟล์ทุกรอบ
# ══════════════════════════════════════════════════════════════════════
# เขียน config ลงไฟล์ด้วยโดยเจตนา: ผลย้อนหลังที่ไม่รู้ว่าใช้กฎอะไรตอนนั้น
# คือผลที่ตีความไม่ได้  ถ้าแก้ตัวเลขข้างล่างวันหนึ่ง จะเห็นในไฟล์ว่าแก้วันไหน
CFG = {
    # (key ใน watchlist, น้ำหนักเป้า, ชื่อที่แสดง, ประเภทค่าธรรมเนียม)
    "universe": [
        {"k": "GLD",     "w": 0.40, "name": "ทองคำ (GLD)",         "fee": "etf"},
        {"k": "GDX",     "w": 0.20, "name": "หุ้นเหมืองทอง (GDX)",  "fee": "etf"},
        {"k": "BTC-USD", "w": 0.40, "name": "Bitcoin",             "fee": "crypto"},
    ],
    "start_cash_usd": 3000.0,
    "monthly_deposit_usd": 300.0,   # เข้าวันแรกของเดือนที่ bot ได้รัน
    "fee_bps": 10,                  # 0.10% ต่อคำสั่ง (เท่า taker ของ Binance spot)
    "fee_min_usd_etf": 1.0,         # ค่าคอมขั้นต่ำแบบโบรกหุ้นสหรัฐ
    "slippage_bps": 5,              # 0.05% — ราคาที่ได้จริงแย่กว่าราคาปิดเสมอ
    "min_trade_usd": 25.0,          # เล็กกว่านี้ ค่าธรรมเนียมกินหมด
    "stale_days": 7,                # ราคาเก่ากว่านี้ = ไม่เทรดตัวนั้นวันนั้น
    # v60 — ซื้อกี่ % ของช่องว่างที่ห่างจากน้ำหนักเป้า ต่อหนึ่งวัน
    # ตัวเลขนี้ถูกคูณด้วย "ขนาดไม้" (0.5–1.5) ที่ fetch_signals.py คำนวณมา
    # base 0.30 × ไม้ 0.5–1.5 → เข้าจริง 15–45% ของช่องว่าง
    "aggression": {"base": 0.30, "unknown": 0.15},
    "trim_over_target": 1.25,       # ถือเกินเป้า 25% + ของแพง → ขายกลับมาที่เป้า
    "derisk_frac": 0.25,            # ไม่ผ่านประตู + ของยังแพง → ขายทิ้ง 25%
    "expensive_size": 0.90,         # ขนาดไม้ต่ำกว่านี้ = "ยังแพง" ในสายตาชั้น 3
    "max_trades_keep": 300,
    "max_equity_days": 730,
}

SCHEMA = 1

# ══════════════════════════════════════════════════════════════════════
# RULES — ชื่อชุดกฎที่ใช้ตัดสินใจ ประทับลงทุกคำสั่งและทุกการตัดสินใจ (v61)
# ══════════════════════════════════════════════════════════════════════
# บั๊กที่แก้: วันที่ 27 ก.ย. 2026 บอทตัดสินใจด้วยกฎ v59 (ซื้อ BTC-USD) แล้วรอบถัดมา
# (โค้ด v60) เห็นว่าเทรดวันนี้ไปแล้ว จึงยกการตัดสินใจเดิมมา แต่เขียน `config`
# ของ v60 ทับ — ไฟล์จึงบอกว่าใช้กฎ v60 ทั้งที่คำสั่งนั้นขัดกับกฎ v60 ตรง ๆ
# (BTC-USD ไม่ผ่านประตู: โมเมนตัม 12-1 = −14.2%)
# `config` เป็น "ค่าปัจจุบัน" ไม่ใช่ "ค่าที่ใช้ตอนเทรด" — ต้องประทับที่ตัวคำสั่งเอง
# และเก็บประวัติการเปลี่ยนกฎไว้ใน config_log  เปลี่ยนเกณฑ์ครั้งหน้าให้เปลี่ยนชื่อนี้ด้วย
RULES = "v60-gate"   # ประตู (MA200 + โมเมนตัม 12-1) × ขนาดไม้ · ดู fetch_signals.py


def fee_for(notional: float, kind: str) -> float:
    """ค่าธรรมเนียม + slippage ของคำสั่งหนึ่ง (USD)

    คิด slippage เป็นค่าธรรมเนียมแทนการขยับราคา เพราะให้ผลเดียวกันกับมูลค่า
    พอร์ตแต่ทำให้ราคาที่บันทึกใน trade log ยังเป็นราคาปิดจริงที่ตรวจสอบย้อนได้
    """
    n = abs(notional)
    f = n * CFG["fee_bps"] / 10000 + n * CFG["slippage_bps"] / 10000
    if kind == "etf":
        f = max(f, CFG["fee_min_usd_etf"])
    return round(f, 4)


def age_days(updated) -> int | None:
    if not updated:
        return None
    try:
        d = datetime.strptime(str(updated)[:10], "%Y-%m-%d").replace(
            tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return max(0, (NOW - d).days)


def new_book(cash: float) -> dict:
    return {"cash": round(cash, 4), "pos": {}, "units": 0.0}


def book_equity(book: dict, px: dict) -> float:
    v = book["cash"]
    for k, p in book["pos"].items():
        price = px.get(k)
        if price:
            v += p["qty"] * price
    return v


def deposit(book: dict, amount: float, px: dict) -> None:
    """เติมเงิน + ออกหน่วยที่ NAV ปัจจุบัน (ระบบหน่วยแบบกองทุน)

    ต้องคิด NAV *ก่อน* เงินเข้าเสมอ ไม่งั้นเงินที่เพิ่งเข้าจะไปเจือจาง NAV
    ของตัวเอง แล้วผลตอบแทนที่รายงานจะต่ำกว่าความจริงทุกครั้งที่เติมเงิน
    """
    eq = book_equity(book, px)
    nav = (eq / book["units"]) if book["units"] > 0 and eq > 0 else 1.0
    book["units"] += amount / nav
    book["cash"] += amount


def trade(book: dict, k: str, qty: float, price: float, kind: str) -> float:
    """qty > 0 = ซื้อ · qty < 0 = ขาย — คืนค่าธรรมเนียมที่จ่าย

    cost เก็บเป็น "ต้นทุนของหน่วยที่ยังถืออยู่" (WACC × จำนวนคงเหลือ)
    ไม่ใช่ยอดซื้อสะสม — ขายบางส่วนแล้วต้นทุนต้องลดลงตามสัดส่วน ไม่งั้น
    %กำไรจะผิดเป็นเท่าตัวหลังการขายครั้งแรก (บั๊กเดียวกับ v50 ใน shared.js)
    """
    notional = qty * price
    f = fee_for(notional, kind)
    p = book["pos"].setdefault(k, {"qty": 0.0, "cost": 0.0})
    if qty > 0:
        book["cash"] -= notional + f
        p["qty"] += qty
        p["cost"] += notional + f          # ค่าธรรมเนียมซื้อเป็นส่วนหนึ่งของต้นทุน
    else:
        sold = min(abs(qty), p["qty"])
        wacc = (p["cost"] / p["qty"]) if p["qty"] > 0 else 0.0
        p["cost"] = max(0.0, p["cost"] - wacc * sold)
        p["qty"] = max(0.0, p["qty"] - sold)
        book["cash"] += sold * price - f
    if p["qty"] <= 1e-12:
        book["pos"].pop(k, None)
    book["cash"] = round(book["cash"], 6)
    return f


def decide(sig: dict, cur_val: float, target_val: float) -> tuple[str, float, str]:
    """กฎการตัดสินใจ — pure function ทดสอบได้โดยไม่ต้องมี state

    คืน (action, fraction, เหตุผล)
      action ∈ buy | sell | hold
      fraction = สัดส่วนของช่องว่าง (buy) หรือของจำนวนที่ถือ (sell)

    ══════════════════════════════════════════════════════════════════
    เกณฑ์ 3 ชั้น — bot อ่านผลจาก fetch_signals.py ไม่คิดเกณฑ์ของตัวเอง
    ══════════════════════════════════════════════════════════════════
      ชั้น 1 ประตู (gate)  — ตัดสินว่าซื้อได้ไหม   pass / fail / unknown
      ชั้น 3 ขนาดไม้ (size) — ตัดสินว่าเท่าไหร่      0.5 – 1.5
    (ชั้น 2 อันดับ ใช้ตอนเลือกว่าจะเทรดตัวไหนก่อนเมื่อเงินสดจำกัด)

    กฎเหล็กข้อเดียว: **ไม่ผ่านประตู = ห้ามซื้อ** ไม่ว่าขนาดไม้จะใหญ่แค่ไหน
    ขนาดไม้ถูกบีบไว้ที่ 0.5–1.5 จึงไม่มีทางพลิกประตูได้ในทางคณิตศาสตร์
    ต่อให้ RSI 15 พร้อมย่อ 40% — มันคูณกับศูนย์

    นี่คือเหตุผลทั้งหมดที่ v60 รื้อเกณฑ์: รุ่นก่อนใช้ ma200 เป็นประตูแต่หน้าเว็บ
    ใช้ score = trend + timing ตัดสิน สองที่จึงพูดไม่ตรงกัน  ตอนนี้ทั้ง bot
    และทั้งสองหน้าอ่าน gate/size ตัวเดียวกันจาก pipeline — เถียงกันเองไม่ได้อีก
    """
    gate = sig.get("gate")
    size = sig.get("size")
    size = 1.0 if size is None else max(0.5, min(1.5, float(size)))
    expensive = size <= CFG["expensive_size"]
    A = CFG["aggression"]

    if gate == "fail":
        why = sig.get("gate_why") or "ไม่ผ่านประตูเทรนด์"
        if cur_val > 0 and expensive:
            return ("sell", CFG["derisk_frac"],
                    f"{why} และยังไม่ถูกพอ (ไม้ ×{size:.2f}) — ลดน้ำหนัก")
        # ไม่ผ่านประตูแต่ของถูกมากแล้ว: หยุดซื้อ แต่ไม่ขายตรงจุดต่ำ
        return ("hold", 0.0, f"{why} — หยุดซื้อจนกว่าเทรนด์ยาวจะกลับมา")

    gap = target_val - cur_val
    if gap > 0:
        base = A["base"] if gate == "pass" else A["unknown"]
        note = ("" if gate == "pass"
                else " · ยังยืนยันเทรนด์ไม่ได้ จึงเข้าครึ่งเดียวของปกติ")
        return ("buy", round(min(1.0, base * size), 4),
                f"{sig.get('gate_why') or 'ผ่านประตู'} · ขนาดไม้ ×{size:.2f}{note}")

    if (target_val > 0 and cur_val > target_val * CFG["trim_over_target"]
            and expensive):
        over = cur_val - target_val
        return ("sell", min(1.0, over / cur_val),
                f"เกินน้ำหนักเป้า {cur_val / target_val - 1:.0%} และยังแพง "
                f"(ไม้ ×{size:.2f}) — ขายกลับมาที่เป้า")
    return ("hold", 0.0, "อยู่ที่น้ำหนักเป้าแล้ว — ไม่มีอะไรต้องทำ")


def max_drawdown(navs: list[float]) -> float:
    peak, mdd = 0.0, 0.0
    for v in navs:
        if v > peak:
            peak = v
        if peak > 0:
            mdd = min(mdd, v / peak - 1)
    return round(mdd * 100, 2)


def main() -> int:
    if not os.path.exists(MD):
        print(f"::warning::ไม่พบ {MD} — ข้ามรอบนี้ (ไม่ใช่ error: bot ต้องรอ pipeline)")
        return 0
    with open(MD, encoding="utf-8") as f:
        payload = json.load(f)

    watch = payload.get("watchlist") or {}
    data = payload.get("data") or {}
    try:
        usdthb = float((data.get("USDTHB") or {}).get("value"))
    except (TypeError, ValueError):
        usdthb = None

    # ── ราคา + สัญญาณของสินทรัพย์ในสนาม ────────────────────────────
    px, sigs, skipped = {}, {}, []
    for u in CFG["universe"]:
        k = u["k"]
        e = watch.get(k)
        if not e or not e.get("price"):
            skipped.append({"k": k, "why": "ไม่มีข้อมูลใน watchlist"})
            continue
        a = age_days(e.get("updated"))
        if a is None or a > CFG["stale_days"]:
            skipped.append({"k": k,
                            "why": f"ราคาเก่า {a if a is not None else '?'} วัน — ไม่เทรด"})
            # ยังเอาราคาไปตีมูลค่าพอร์ต (ราคาเก่ายังดีกว่านับเป็น 0 — บทเรียน
            # เดียวกับ last-known-price ใน shared.js) แต่ห้ามใช้ตัดสินใจ
            px[k] = float(e["price"])
            continue
        px[k] = float(e["price"])
        sigs[k] = e

    # ── state ───────────────────────────────────────────────────────
    st = None
    if os.path.exists(OUT) and not os.environ.get("BOT_RESET"):
        try:
            with open(OUT, encoding="utf-8") as f:
                loaded = json.load(f)
            if loaded.get("schema") == SCHEMA:
                st = loaded
            else:
                print(f"  ⚠️  schema {loaded.get('schema')} ≠ {SCHEMA} — เริ่มพอร์ตใหม่")
        except (json.JSONDecodeError, OSError) as e:
            print(f"  ⚠️  อ่าน {OUT} ไม่ได้ ({e}) — เริ่มพอร์ตใหม่")

    if st is None:
        st = {
            "schema": SCHEMA, "started": TODAY, "last_month": None,
            "last_trade_day": None, "deposits": 0.0,
            "bot": new_book(0.0), "bench": new_book(0.0),
            "trades": [], "equity": [],
        }
        print(f"── เริ่มพอร์ตจำลองใหม่ ({TODAY}) ─────────────")

    bot, bench = st["bot"], st["bench"]
    log = []

    def add_trade(book_name, k, side, qty, price, f, why):
        log.append({"d": TODAY, "book": book_name, "k": k, "side": side,
                    "qty": round(qty, 8), "px": round(price, 6),
                    "usd": round(abs(qty) * price, 2), "fee": round(f, 4),
                    "why": why, "rules": RULES})

    # ── 1. เงินเข้า ─────────────────────────────────────────────────
    # เงินก้อนแรกเข้าทั้งสองพอร์ตพร้อมกันวันเดียวกัน จากนั้นเติมเดือนละครั้ง
    # ในรอบแรกของเดือน  ถ้า pipeline ไม่ได้รันต้นเดือน เงินเข้าวันที่ได้รันจริง
    # (ทั้งสองพอร์ตเหมือนกัน จึงไม่ทำให้การเปรียบเทียบเอียง)
    dep = 0.0
    if st["last_month"] is None:
        dep = CFG["start_cash_usd"]
    elif st["last_month"] != MONTH:
        dep = CFG["monthly_deposit_usd"]
    if dep > 0:
        deposit(bot, dep, px)
        deposit(bench, dep, px)
        st["deposits"] = round(st["deposits"] + dep, 2)
        st["last_month"] = MONTH
        print(f"  ＋ เงินเข้าทั้งสองพอร์ต ${dep:,.2f} (รวม ${st['deposits']:,.2f})")

    traded_today = st.get("last_trade_day") == TODAY

    # ── 2. พอร์ต DCA — ลงทุนเงินที่เพิ่งเข้าทันทีตามน้ำหนักคงที่ ──────
    # ไม่เคยขาย ไม่เคยดูสัญญาณ — นี่คือ "การไม่ตัดสินใจ" ที่ใช้เป็นเส้นวัด
    if dep > 0 and not traded_today:
        for u in CFG["universe"]:
            k, p = u["k"], px.get(u["k"])
            if not p:
                continue
            amt = dep * u["w"]
            if amt < 0.01 or amt > bench["cash"]:
                amt = min(amt, bench["cash"])
            if amt < 0.01:
                continue
            f = fee_for(amt, u["fee"])
            qty = (amt - f) / p
            if qty <= 0:
                continue
            paid = trade(bench, k, qty, p, u["fee"])
            add_trade("dca", k, "buy", qty, p, paid, "DCA ตามน้ำหนักคงที่")

    # ── 3. พอร์ต BOT — ตัดสินใจตามสัญญาณ วันละครั้ง ─────────────────
    decisions = []
    if traded_today:
        print(f"  ↻ เทรดของวันที่ {TODAY} ทำไปแล้ว — รอบนี้แค่ตีมูลค่าใหม่")
        decisions = st.get("today", {}).get("decisions", [])
    else:
        eq = book_equity(bot, px)
        # v60 — เรียงด้วย "อันดับ" (ชั้น 2: โมเมนตัมหารความผันผวน) ไม่ใช่จังหวะ
        # เงินสดมีจำกัด ตัวที่เทรนด์แข็งที่สุดต่อหนึ่งหน่วยความเสี่ยงควรได้เลือกก่อน
        # เดิมเรียงด้วย timing = ให้ของที่ตกแรงที่สุดได้เงินก่อน ซึ่งเป็น
        # mean-reversion ที่แอบเข้ามาตัดสินใจอีกชั้น ทั้งที่ควรอยู่แค่ขนาดไม้
        order = sorted(CFG["universe"],
                       key=lambda u: -(sigs.get(u["k"], {}).get("rank") or -99))
        for u in order:
            k, p = u["k"], px.get(u["k"])
            sig = sigs.get(k)
            if not p or not sig:
                why = next((x["why"] for x in skipped if x["k"] == k), "ไม่มีข้อมูล")
                decisions.append({"k": k, "name": u["name"], "act": "skip",
                                  "why": why, "usd": 0, "rules": RULES})
                continue
            held = bot["pos"].get(k, {"qty": 0.0})
            cur = held["qty"] * p
            target = eq * u["w"]
            act, frac, why = decide(sig, cur, target)
            usd = 0.0
            if act == "buy":
                usd = min(bot["cash"], (target - cur) * frac)
                if usd < CFG["min_trade_usd"]:
                    act, why = ("hold", why + f" · แต่ได้แค่ ${usd:,.0f} "
                                f"(ต่ำกว่าขั้นต่ำ ${CFG['min_trade_usd']:,.0f}) — ไม่ส่งคำสั่ง")
                    usd = 0.0
                else:
                    f_ = fee_for(usd, u["fee"])
                    qty = (usd - f_) / p
                    paid = trade(bot, k, qty, p, u["fee"])
                    add_trade("bot", k, "buy", qty, p, paid, why)
            elif act == "sell":
                qty = held["qty"] * frac
                usd = qty * p
                if usd < CFG["min_trade_usd"]:
                    act, why = ("hold", why + " · ยอดเล็กเกินกว่าจะคุ้มค่าธรรมเนียม")
                    usd = 0.0
                else:
                    paid = trade(bot, k, -qty, p, u["fee"])
                    add_trade("bot", k, "sell", qty, p, paid, why)
            decisions.append({"k": k, "name": u["name"], "act": act,
                              "why": why, "usd": round(usd, 2),
                              "gate": sig.get("gate"), "size": sig.get("size"),
                              "rank": sig.get("rank"), "mom12_1": sig.get("mom12_1"),
                              "ma200": sig.get("ma200"), "rsi": sig.get("rsi"),
                              "price": p, "rules": RULES})
            print(f"  {'▲' if act=='buy' else '▼' if act=='sell' else '·'} "
                  f"{k:<8} {act:<5} ${usd:>8,.2f}  {why}")
        st["last_trade_day"] = TODAY

    # ── 4. ตีมูลค่า + บันทึกเส้นผลตอบแทน ───────────────────────────
    bot_eq, bench_eq = book_equity(bot, px), book_equity(bench, px)
    bot_nav = bot_eq / bot["units"] if bot["units"] > 0 else 1.0
    bench_nav = bench_eq / bench["units"] if bench["units"] > 0 else 1.0

    eqs = [r for r in st["equity"] if r[0] != TODAY]
    eqs.append([TODAY, round(bot_nav, 6), round(bench_nav, 6),
                round(bot_eq, 2), round(bench_eq, 2), round(st["deposits"], 2)])
    eqs.sort(key=lambda r: r[0])
    st["equity"] = eqs[-CFG["max_equity_days"]:]

    st["trades"] = (st.get("trades") or []) + log
    st["trades"] = st["trades"][-CFG["max_trades_keep"]:]

    def pos_view(book):
        out = []
        for u in CFG["universe"]:
            k = u["k"]
            p_ = book["pos"].get(k)
            if not p_ or p_["qty"] <= 0:
                continue
            price = px.get(k)
            val = p_["qty"] * price if price else None
            out.append({
                "k": k, "name": u["name"], "qty": round(p_["qty"], 8),
                "cost": round(p_["cost"], 2),
                "price": price, "val": None if val is None else round(val, 2),
                "pl": None if val is None else round(val - p_["cost"], 2),
                "plPct": None if not (val and p_["cost"] > 0)
                         else round((val / p_["cost"] - 1) * 100, 2),
                "weight": None if not (val and book_equity(book, px) > 0)
                          else round(val / book_equity(book, px) * 100, 1),
                "target": round(u["w"] * 100, 1),
            })
        return out

    bot_trades = [t for t in st["trades"] if t["book"] == "bot"]
    st["stats"] = {
        "deposits": round(st["deposits"], 2),
        "bot": {"equity": round(bot_eq, 2), "nav": round(bot_nav, 6),
                "ret": round((bot_nav - 1) * 100, 2),
                "cash": round(bot["cash"], 2),
                "cashPct": round(bot["cash"] / bot_eq * 100, 1) if bot_eq > 0 else None,
                "mdd": max_drawdown([r[1] for r in st["equity"]]),
                "positions": pos_view(bot)},
        "bench": {"equity": round(bench_eq, 2), "nav": round(bench_nav, 6),
                  "ret": round((bench_nav - 1) * 100, 2),
                  "cash": round(bench["cash"], 2),
                  "mdd": max_drawdown([r[2] for r in st["equity"]]),
                  "positions": pos_view(bench)},
        # ตัวเลขที่พอร์ตนี้มีไว้ตอบ: จับจังหวะชนะไม่จับจังหวะกี่ percentage point
        "edge_pp": round((bot_nav - bench_nav) * 100, 2),
        "days": len(st["equity"]),
        "n_trades": len(bot_trades),
        "fees_paid": round(sum(t["fee"] for t in bot_trades), 2),
        "usdthb": usdthb,
    }
    # กฎของ "วันนี้" = กฎที่ใช้ตัดสินใจจริง ไม่ใช่กฎของโค้ดที่รันรอบนี้
    # ถ้าวันนี้เทรดไปแล้วด้วยกฎเก่า ต้องคงชื่อกฎเก่าไว้ (หรือ None ถ้าไฟล์รุ่นก่อน v61)
    prev_today = st.get("today") or {}
    today_rules = (prev_today.get("rules") if traded_today and prev_today.get("date") == TODAY
                   else RULES)
    st["today"] = {"date": TODAY, "decisions": decisions, "skipped": skipped,
                   "rules": today_rules}
    # ประวัติกฎ — เพิ่มแถวเมื่อชื่อกฎหรือพารามิเตอร์เปลี่ยน  ไม่เขียนทับของเดิม
    clog = st.setdefault("config_log", [])
    if not clog or clog[-1].get("rules") != RULES or clog[-1].get("config") != CFG:
        clog.append({"from": TODAY, "rules": RULES, "config": CFG})
    st["config"] = CFG            # ค่าปัจจุบัน — หน้าเว็บอ่านไปแสดงกฎ
    st["rules"] = RULES
    st["computed_at"] = FETCHED_AT

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, separators=(",", ":"))

    s = st["stats"]
    print("─────────────────────────────────────────────")
    print(f"BOT   NAV {s['bot']['nav']:.4f} ({s['bot']['ret']:+.2f}%)  "
          f"มูลค่า ${s['bot']['equity']:,.2f}  เงินสด {s['bot']['cashPct']}%  "
          f"drawdown {s['bot']['mdd']}%")
    print(f"DCA   NAV {s['bench']['nav']:.4f} ({s['bench']['ret']:+.2f}%)  "
          f"มูลค่า ${s['bench']['equity']:,.2f}  drawdown {s['bench']['mdd']}%")
    print(f"ส่วนต่าง {s['edge_pp']:+.2f} pp · เดินมา {s['days']} วัน · "
          f"เทรด {s['n_trades']} ครั้ง · ค่าธรรมเนียมสะสม ${s['fees_paid']:,.2f}")
    if skipped:
        for x in skipped:
            print(f"  ⚠️  ข้าม {x['k']}: {x['why']}")
    print(f"เขียน {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
