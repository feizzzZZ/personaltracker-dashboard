#!/usr/bin/env python3
"""
Finance OS — signal pipeline  (v1)
────────────────────────────────────────────────────────────────────────
รันต่อจาก fetch_market_data.py ในงานเดียวกัน อ่าน market-data.json ที่เพิ่งเขียน
แล้วเติม 3 อย่างที่ยังไม่มี:
 
  1. macro ที่ตายไปตั้งแต่ v44 ตัด FRED  — เอากลับมาจากแหล่งที่ "พิสูจน์แล้ว"
     ว่าเข้าถึงได้จาก GitHub Actions (probe run #1 · 20 ก.ย. 2026)
  2. สัญญาณรายตัวของทุกสินทรัพย์ที่ถืออยู่ — RSI / MA / drawdown / จังหวะ DCA
  3. ภาพความเสี่ยงระดับตลาด — breadth, credit stress, ความผันผวน
 
และเก็บ snapshot รายวันลง signal-history.json ตั้งแต่วันแรก เพื่อให้ backtest
ได้จริงในอนาคต (ถ้าเริ่มเก็บทีหลัง ย้อนหลังไม่ได้ — ข้อมูลไม่มีใครเก็บให้)
 
ทำไมเป็นไฟล์แยก ไม่แก้ fetch_market_data.py:
  pipeline เดิมผ่านมาแล้วหลายสิบรอบ การแทรกโค้ดใหม่เข้าไปกลางไฟล์ 600 บรรทัด
  ทำให้บั๊กใหม่กับบั๊กเก่าแยกกันไม่ออกเวลา run fail — แยกไฟล์แล้ว log บอกชัด
  ว่าขั้นไหนพัง และถ้าขั้นนี้ล้ม market-data.json ที่เขียนไปแล้วยังใช้ได้ปกติ
 
รันเอง:  python3 scripts/fetch_signals.py
stdlib ล้วน ไม่ต้องใช้ API key
"""
import json
import math
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
 
MD = os.environ.get("MARKET_DATA_OUT", "market-data.json")
HIST = os.environ.get("SIGNAL_HISTORY_OUT", "signal-history.json")
HIST_MAX_DAYS = 500          # ~2 ปีทำการ พอสำหรับ backtest สัญญาณระยะกลาง
 
# ต้องตรงกับ SIGNAL_MAX_DAYS ใน shared.js เป๊ะ ๆ
# ถ้าสองที่ไม่ตรงกัน breadth ที่คำนวณใน pipeline จะไม่ตรงกับที่หน้าเว็บคำนวณ
# จากชุดข้อมูลเดียวกัน — ตัวเลขขัดกันเองโดยไม่มีใครเห็น
SIGNAL_MAX_DAYS = 7
 
UA_BOT = "Mozilla/5.0 (compatible; FinanceOS-signals/1)"
_CTX = ssl.create_default_context()
DEADLINE_SEC = int(os.environ.get("SIGNALS_DEADLINE", "300"))
_T0 = time.monotonic()
NOW = datetime.now(timezone.utc)
TODAY = NOW.strftime("%Y-%m-%d")
FETCHED_AT = NOW.isoformat()
 
warnings: list[str] = []
 
 
def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"  ⚠️  {msg}", file=sys.stderr)
 
 
def budget_left() -> float:
    return DEADLINE_SEC - (time.monotonic() - _T0)
 
 
def http_get(url: str, tries: int = 2, timeout: int = 12) -> bytes | None:
    for attempt in range(tries):
        if budget_left() <= 0:
            warn(f"หมดงบเวลา — ข้าม {url[:60]}")
            return None
        try:
            eff = max(3, min(timeout, int(budget_left())))
            req = urllib.request.Request(url, headers={"User-Agent": UA_BOT})
            with urllib.request.urlopen(req, timeout=eff, context=_CTX) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 429, 502, 503) and attempt < tries - 1:
                time.sleep(min(2 ** attempt * 2, max(0, budget_left())))
                continue
            warn(f"HTTP {e.code} · {url[:70]}")
            return None
        except Exception as e:                                   # noqa: BLE001
            if attempt < tries - 1:
                time.sleep(min(2 ** attempt, max(0, budget_left())))
                continue
            warn(f"{type(e).__name__}: {e} · {url[:70]}")
            return None
    return None
 
 
def yahoo_chart(symbol: str, rng: str = "1y", interval: str = "1d"):
    """คืน (dates, closes) — กรอง null ที่ Yahoo ใส่มาในวันหยุดตลาด"""
    sym = urllib.parse.quote(symbol, safe="")
    raw = http_get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
                   f"?range={rng}&interval={interval}")
    if not raw:
        return [], []
    try:
        res = json.loads(raw)["chart"]["result"][0]
        ts = res["timestamp"]
        closes = res["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        warn(f"Yahoo: อ่านข้อมูล {symbol} ไม่ได้")
        return [], []
    d, v = [], []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        d.append(datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"))
        v.append(float(c))
    return d, v
 
 
def parallel_charts(specs, workers: int = 6):
    out: dict[str, tuple[list, list]] = {}
    if budget_left() <= 0:
        return out
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(yahoo_chart, s, r, i): s for s, r, i in specs}
        for f, sym in futs.items():
            try:
                d, v = f.result()
                if v:
                    out[sym] = (d, v)
            except Exception as e:                               # noqa: BLE001
                warn(f"{type(e).__name__}: {e} · {sym}")
    return out
 
 
# ══════════════════════════════════════════════════════════════════════
# ตัวชี้วัด — ฟังก์ชันบริสุทธิ์ล้วน ทดสอบได้โดยไม่ต้องต่อเน็ต
# ══════════════════════════════════════════════════════════════════════
def rsi14(vals: list[float]) -> float | None:
    """Wilder RSI(14) — smoothing แบบ EMA ตามนิยามดั้งเดิม ไม่ใช่ SMA
 
    ใช้สูตรเดียวกับ fetch_market_data.py เป๊ะ ๆ ถ้าแก้ที่นี่ต้องแก้ที่นั่นด้วย
    ไม่งั้น SP500_RSI ในหน้า Macro กับ RSI รายตัวจะคำนวณคนละแบบเงียบ ๆ
    """
    if len(vals) < 15:
        return None
    gains, losses = [], []
    for i in range(1, len(vals)):
        ch = vals[i] - vals[i - 1]
        gains.append(max(ch, 0.0))
        losses.append(max(-ch, 0.0))
    ag = sum(gains[:14]) / 14
    al = sum(losses[:14]) / 14
    for i in range(14, len(gains)):
        ag = (ag * 13 + gains[i]) / 14
        al = (al * 13 + losses[i]) / 14
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 1)
 
 
def pct_change(vals: list[float], days: int) -> float | None:
    if len(vals) <= days:
        return None
    prev = vals[-1 - days]
    if prev == 0:
        return None
    return round((vals[-1] / prev - 1) * 100, 2)
 
 
def sma(vals: list[float], n: int) -> float | None:
    return sum(vals[-n:]) / n if len(vals) >= n else None
 
 
def vol_annual(vals: list[float], n: int = 30) -> float | None:
    """ความผันผวนรายปี (%) จากผลตอบแทนรายวัน n วันล่าสุด
 
    ใช้ 252 วันทำการต่อปีตามมาตรฐานตลาดหุ้น — คริปโตเทรด 365 วัน ค่าที่ได้
    จึงต่ำกว่าความจริงเล็กน้อย แต่ใช้ฐานเดียวกันทุกตัวเพื่อให้ "เทียบกันได้"
    สำคัญกว่าความถูกต้องสัมบูรณ์ของแต่ละตัว
    """
    if len(vals) < n + 1:
        return None
    rets = []
    for i in range(len(vals) - n, len(vals)):
        if vals[i - 1] == 0:
            continue
        rets.append(vals[i] / vals[i - 1] - 1)
    if len(rets) < 5:
        return None
    m = sum(rets) / len(rets)
    var = sum((r - m) ** 2 for r in rets) / (len(rets) - 1)
    return round(math.sqrt(var) * math.sqrt(252) * 100, 1)
 
 
def _age_days(updated) -> int | None:
    """อายุเป็นจำนวนวันเต็มจากสตริงวันที่ YYYY-MM-DD — ไม่รู้วัน คืน None
 
    ใช้ floor เหมือน shared.js (v51 แก้บั๊ก round/floor ที่ไม่ตรงกันมาแล้ว)
    ราคาของวันที่ 10 มีอายุ 11 วันจนถึงวันที่ 22 เวลา 00:00Z
    """
    if not updated:
        return None
    try:
        d = datetime.strptime(str(updated)[:10], "%Y-%m-%d").replace(
            tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return max(0, (NOW - d).days)
 
 
def zscore(vals: list[float], n: int = 252) -> float | None:
    """ค่าล่าสุดอยู่ห่างค่าเฉลี่ย n วันกี่ส่วนเบี่ยงเบนมาตรฐาน"""
    w = vals[-n:]
    if len(w) < 30:
        return None
    m = sum(w) / len(w)
    var = sum((x - m) ** 2 for x in w) / (len(w) - 1)
    sd = math.sqrt(var)
    if sd == 0:
        return None
    return round((w[-1] - m) / sd, 2)
 
 
def range_pos(vals: list[float], n: int = 252) -> tuple[float, float] | None:
    """คืน (ตำแหน่งในกรอบ 0-100, %ห่างจากจุดสูงสุด)
 
    0 = จุดต่ำสุดของช่วง · 100 = จุดสูงสุด  ใช้ดูว่าของ "ถูก" หรือ "แพง"
    เทียบกับตัวมันเองในรอบปี ซึ่งเป็นคำถามที่ตรงกับการ DCA มากกว่าราคาดิบ
    """
    w = vals[-n:]
    if len(w) < 30:
        return None
    hi, lo, cur = max(w), min(w), w[-1]
    pos = 50.0 if hi == lo else round((cur - lo) / (hi - lo) * 100, 1)
    dd = 0.0 if hi == 0 else round((cur / hi - 1) * 100, 1)
    return pos, dd
 
 
# ══════════════════════════════════════════════════════════════════════
# คะแนนรายตัว — แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้ทดสอบเกณฑ์ได้โดยตรง
# ══════════════════════════════════════════════════════════════════════
def score_asset(trend_up, rsi, dd, pos52):
    """คืน (คะแนนเทรนด์, คะแนนจังหวะ, ป้ายกำกับ, เหตุผล)
 
    ══════════════════════════════════════════════════════════════════
    ทำไมต้องเป็น "สองคะแนน" ไม่ใช่คะแนนเดียว  (v3)
    ══════════════════════════════════════════════════════════════════
    รุ่นก่อนรวมทุกอย่างเป็นเลขเดียวแล้วเกิดกรณีที่ขัดกับกฎของตัวเอง:
      CPALL — RSI 29 (+2) · ย่อ 19% (+1) · แต่หลุด MA200 (−2) → รวม +1
      แล้วขึ้นป้ายว่า "เข้าได้ตามแผน" ทั้งที่ข้อความใต้ตารางเขียนว่า
      "ของที่ตกแรงแต่หลุด MA200 ได้คะแนนติดลบ"
    การบวกกันทำให้ "ของถูก" กลบ "เทรนด์พัง" ได้ ซึ่งเป็นกับดักที่ตั้งใจเลี่ยง
 
    แยกเป็นสองแกนแล้วมองเห็นทันทีว่าเลขมาจากไหน:
      เทรนด์  — ทิศทางระยะยาวยังอยู่ไหม  (MA200)
      จังหวะ  — ตอนนี้ถูกหรือแพงเทียบตัวเอง (RSI · ระยะห่างจุดสูงสุด · ตำแหน่งในกรอบปี)
    สองอย่างนี้ตอบคนละคำถาม การบีบเป็นเลขเดียวคือการทิ้งข้อมูลทิ้งไป
 
    ป้ายกำกับมาจาก "ตาราง 2 แกน" ที่เขียนกฎไว้ตรง ๆ ไม่ใช่จากผลบวก
    กฎเหล็ก: เทรนด์ติดลบ → ไม่มีทางได้ป้ายที่แปลว่า "ซื้อเพิ่มได้"
             ต่อให้จังหวะดีแค่ไหน อย่างมากที่สุดคือ "รอสัญญาณกลับตัว"
    """
    why: list[str] = []
 
    # ── แกนที่ 1: เทรนด์ ───────────────────────────────────────────
    if trend_up is True:
        trend = 1
        why.append("เหนือ MA200 — เทรนด์ยาวยังไม่หัก")
    elif trend_up is False:
        trend = -2
        why.append("ต่ำกว่า MA200 — เทรนด์ยาวหักแล้ว")
    else:
        trend = 0            # ข้อมูลไม่ถึง 200 วัน = ไม่รู้ ไม่ใช่แย่
 
    # ── แกนที่ 2: จังหวะ (ถูก/แพงเทียบตัวเอง) ──────────────────────
    timing = 0
    if rsi is not None:
        if rsi < 30:
            timing += 2
            why.append(f"RSI {rsi:.0f} — oversold")
        elif rsi < 45:
            timing += 1
            why.append(f"RSI {rsi:.0f} — อ่อนตัว")
        elif rsi > 75:
            timing -= 2
            why.append(f"RSI {rsi:.0f} — overbought")
        elif rsi > 65:
            timing -= 1
            why.append(f"RSI {rsi:.0f} — ร้อน")
 
    if dd is not None:
        if dd <= -20:
            timing += 2
            why.append(f"ต่ำกว่าจุดสูงสุด 1 ปี {abs(dd):.0f}%")
        elif dd <= -10:
            timing += 1
            why.append(f"ย่อจากจุดสูงสุด {abs(dd):.0f}%")
        elif dd >= -1:
            timing -= 1
            why.append("อยู่ที่จุดสูงสุดรอบปี")
 
    if pos52 is not None:
        if pos52 >= 90:
            timing -= 1
        elif pos52 <= 15:
            timing += 1
 
    timing = max(-4, min(4, timing))
 
    # ── ป้ายกำกับ: ตาราง 2 แกน ─────────────────────────────────────
    if trend < 0:
        # เทรนด์หักแล้ว — ห้ามมีป้ายที่ชวนให้ซื้อเพิ่ม ไม่ว่าจังหวะจะดีแค่ไหน
        if timing >= 3:
            label = "รอสัญญาณกลับตัว"     # ถูกมาก แต่ยังไม่ใช่จังหวะเข้า
        elif timing <= -1:
            label = "ลดน้ำหนัก"           # เทรนด์พัง + ยังแพง = แย่ที่สุด
        else:
            label = "ชะลอเข้าเพิ่ม"
    elif trend > 0:
        if timing >= 3:
            label = "ทยอยเข้าเพิ่ม"        # ย่อแรงในเทรนด์ขาขึ้น = จังหวะที่ดีที่สุด
        elif timing >= 1:
            label = "เข้าได้ตามแผน"
        elif timing >= -1:
            label = "ถือ"
        else:
            label = "ชะลอเข้าเพิ่ม"
    else:
        # ไม่รู้เทรนด์ (ประวัติไม่ถึง 200 วัน) — ไม่เชียร์ให้เข้าหนัก
        # เพดานอยู่ที่ "เข้าได้ตามแผน" เพราะยังยืนยันเทรนด์ไม่ได้
        label = "เข้าได้ตามแผน" if timing >= 1 else (
            "ถือ" if timing >= -1 else "ชะลอเข้าเพิ่ม")
    return trend, timing, label, why
 
 
def bls_yoy(series_id: str):
    """คืน (YoY %, วันที่สังเกต) จาก BLS public API v1 — ไม่ต้องใช้ key
 
    v1 GET คืนข้อมูลย้อนหลัง 3 ปี เรียงจากใหม่ไปเก่า พอสำหรับ YoY
    โควตา 25 ครั้ง/วัน/IP — เราเรียกวันละ 3 ครั้ง จึงไม่ชน
    """
    raw = http_get(f"https://api.bls.gov/publicAPI/v1/timeseries/data/{series_id}",
                   tries=2, timeout=12)
    if not raw:
        return None, None
    try:
        j = json.loads(raw)
    except json.JSONDecodeError:
        warn(f"BLS {series_id}: อ่าน JSON ไม่ได้")
        return None, None
    if j.get("status") != "REQUEST_SUCCEEDED":
        warn(f"BLS {series_id}: {j.get('status')} · {'; '.join(j.get('message') or [])[:90]}")
        return None, None
    try:
        rows = j["Results"]["series"][0]["data"]
    except (KeyError, IndexError, TypeError):
        warn(f"BLS {series_id}: รูปแบบข้อมูลไม่ตรงที่คาด")
        return None, None
    # กรองเฉพาะรายเดือน M01-M12 — M13 คือค่าเฉลี่ยทั้งปี ไม่ใช่ observation
    pts = []
    for r in rows:
        p = str(r.get("period") or "")
        if not (p.startswith("M") and p != "M13"):
            continue
        try:
            pts.append((int(r["year"]), int(p[1:]), float(r["value"])))
        except (KeyError, TypeError, ValueError):
            continue
    if not pts:
        warn(f"BLS {series_id}: ไม่มีข้อมูลรายเดือน")
        return None, None
    pts.sort(reverse=True)
    y, m, v = pts[0]
    obs = f"{y:04d}-{m:02d}-01"
    prior = next((p for p in pts if p[0] == y - 1 and p[1] == m), None)
    if prior is None or prior[2] == 0:
        return None, obs
    return round((v / prior[2] - 1) * 100, 2), obs
 
 
def bls_level(series_id: str):
    """คืน (ค่าล่าสุด, วันที่สังเกต) — สำหรับ series ที่เป็น % อยู่แล้ว เช่นอัตราว่างงาน"""
    raw = http_get(f"https://api.bls.gov/publicAPI/v1/timeseries/data/{series_id}",
                   tries=2, timeout=12)
    if not raw:
        return None, None
    try:
        j = json.loads(raw)
        if j.get("status") != "REQUEST_SUCCEEDED":
            warn(f"BLS {series_id}: {j.get('status')}")
            return None, None
        rows = j["Results"]["series"][0]["data"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        warn(f"BLS {series_id}: อ่านข้อมูลไม่ได้")
        return None, None
    for r in rows:
        p = str(r.get("period") or "")
        if not (p.startswith("M") and p != "M13"):
            continue
        try:
            return round(float(r["value"]), 2), f"{int(r['year']):04d}-{int(p[1:]):02d}-01"
        except (KeyError, TypeError, ValueError):
            continue
    return None, None
 
 
# ══════════════════════════════════════════════════════════════════════
# ค่า FRED ที่ค้างอยู่ — ต้องล้าง ไม่ใช่ปล่อยให้ merge อุ้มไปเรื่อย ๆ
# ══════════════════════════════════════════════════════════════════════
# v44 ตัด FRED ออกจาก pipeline แต่ไม่ได้ลบค่าที่อยู่ในไฟล์ กลไก merge
# (merged_data.update(data)) เก็บ key เดิมไว้เสมอเมื่อรอบนี้ไม่มีค่าใหม่
# ผลคือหน้า Macro โชว์ Fed rate / CPI / ว่างงาน ของ มิ.ย.–ก.ค. 2026
# เหมือนเป็นตัวเลขสด และจะโชว์แบบนั้นตลอดไป — อันตรายกว่าไม่มีข้อมูล
#
# วิธีแยกว่าอันไหนเป็นของ FRED: entry ยุค FRED ไม่มีฟิลด์ "fetched_at"
# (v40 เพิ่มฟิลด์นี้หลัง FRED ถูกตัดไปแล้ว) — เป็นเครื่องหมายที่เชื่อถือได้
# มากกว่าการเดาจาก note และไม่ลบของที่รอบนี้เพิ่งเขียนเองแน่นอน
FRED_LEGACY_KEYS = [
    "FED_RATE", "US10Y", "US2Y", "US_CPI", "US_CORE_CPI", "US_PCE",
    "US_CORE_PCE", "US_GDP", "NFP", "US_UNEMP", "US_REAL10Y",
    "CREDIT_SPREAD", "YIELD_CURVE",
]
 
 
def purge_stale(data: dict, fresh_keys: set) -> list[str]:
    """ลบ key ยุค FRED ที่ไม่มีใครเติมค่าใหม่ให้ — คืนรายชื่อที่ลบ"""
    dropped = []
    for k in FRED_LEGACY_KEYS:
        if k in fresh_keys:
            continue
        e = data.get(k)
        if isinstance(e, dict) and "fetched_at" not in e:
            data.pop(k, None)
            dropped.append(k)
    return dropped
 
 
# ══════════════════════════════════════════════════════════════════════
def main() -> int:
    if not os.path.exists(MD):
        print(f"::error::ไม่พบ {MD} — ต้องรัน fetch_market_data.py ก่อน")
        return 1
    with open(MD, encoding="utf-8") as f:
        payload = json.load(f)
 
    data = payload.setdefault("data", {})
    prices = payload.get("prices", {})
    fresh: dict = {}
 
    def put(key, value, observed, note):
        if value is None:
            return
        fresh[key] = {"value": value, "updated": observed,
                      "fetched_at": FETCHED_AT, "note": note}
 
    # ── 1. Macro จากแหล่งที่ probe พิสูจน์แล้วว่าเข้าถึงได้ ──────────────
    print("── Macro (Yahoo yields) ─────────────────────")
    # probe run #1 (20 ก.ย. 2026) ผ่าน 10/10 รวม 2YY=F ที่ v44 คิดว่าไม่มี
    # จึงใช้ 2s10s ตัวจริงได้ ไม่ต้องสลับไป 3m10y — เกณฑ์ใน computeRegime
    # ถูกตั้งไว้สำหรับ 2s10s อยู่แล้ว การเปลี่ยนตัวตั้งโดยไม่เปลี่ยนเกณฑ์
    # จะทำให้คำอธิบาย "inverted" ผิดความหมาย
    YIELDS = [("US3M", "^IRX"), ("US2Y", "2YY=F"), ("US5Y", "^FVX"),
              ("US10Y", "^TNX"), ("US30Y", "^TYX")]
    ETFS = [("HYG", "HYG"), ("LQD", "LQD"), ("IEF", "IEF"), ("TIP", "TIP")]
    macro_charts = parallel_charts(
        [(s, "1y", "1d") for _, s in YIELDS] + [(s, "2y", "1d") for _, s in ETFS])
 
    ylv: dict[str, float] = {}
    for key, sym in YIELDS:
        d, v = macro_charts.get(sym, ([], []))
        if not v:
            continue
        ylv[key] = v[-1]
        put(key, round(v[-1], 3), d[-1], f"Yahoo {sym}")
        print(f"  ✓ {key:<14} {v[-1]:.3f}%")
 
    if "US10Y" in ylv and "US2Y" in ylv:
        bps = round((ylv["US10Y"] - ylv["US2Y"]) * 100)
        put("YIELD_CURVE", bps, TODAY, "2s10s = ^TNX − 2YY=F (bps)")
        print(f"  ✓ {'YIELD_CURVE':<14} {bps:+d} bps (2s10s)")
    if "US10Y" in ylv and "US3M" in ylv:
        bps3 = round((ylv["US10Y"] - ylv["US3M"]) * 100)
        put("YIELD_CURVE_3M10Y", bps3, TODAY,
            "3m10y = ^TNX − ^IRX (bps) · งานวิจัย Fed ชี้ว่าทำนาย recession แม่นกว่า")
        print(f"  ✓ {'3m10y':<14} {bps3:+d} bps")
 
    # Credit stress — ไม่ใช่ HY OAS ตัวจริง จึงตั้งชื่อ key ใหม่ ไม่ใช้ CREDIT_SPREAD
    # ═══════════════════════════════════════════════════════════════
    # HY OAS ของจริงหาฟรีไม่ได้ (FRED BAMLH0A0HYM2 บล็อกเรา · ICE คิดเงิน)
    # อัตราส่วน HYG/IEF บอก "ทิศทาง" ความเครียดเครดิตได้ แต่หน่วยไม่ใช่ %
    # ถ้าเอาไปใส่ key เดิม เกณฑ์ใน computeRegime (3% / 4.5% / 6%) จะตีความผิด
    # ทั้งหมด — ค่า ratio ~0.87 จะถูกอ่านว่า "spread ต่ำมาก ผ่อนคลาย" ตลอดกาล
    # จึงส่งเป็น z-score ใน key ใหม่ แล้วให้ฝั่ง UI ตั้งเกณฑ์ของตัวเอง
    hyg_d, hyg_v = macro_charts.get("HYG", ([], []))
    ief_d, ief_v = macro_charts.get("IEF", ([], []))
    if hyg_v and ief_v:
        n = min(len(hyg_v), len(ief_v))
        ratio = [hyg_v[-n:][i] / ief_v[-n:][i] for i in range(n) if ief_v[-n:][i]]
        z = zscore(ratio)
        if z is not None:
            # ratio สูง = HY ทำได้ดีกว่าพันธบัตรรัฐบาล = ความเครียดต่ำ
            # กลับเครื่องหมายให้ "บวก = เครียด" อ่านง่ายกว่าเมื่อเอาไปทำสัญญาณเตือน
            put("CREDIT_STRESS", round(-z, 2), hyg_d[-1],
                "z-score ของอัตราส่วน HYG/IEF (กลับเครื่องหมาย) · "
                "บวก = ความเครียดเครดิตสูงกว่าค่าเฉลี่ย 1 ปี · ไม่ใช่ HY OAS")
            print(f"  ✓ {'CREDIT_STRESS':<14} {-z:+.2f} SD")
 
    print("── Macro (BLS) ──────────────────────────────")
    cpi, cpi_obs = bls_yoy("CUUR0000SA0")
    if cpi is not None:
        put("US_CPI", cpi, cpi_obs, "BLS CUUR0000SA0 · CPI-U YoY (ไม่ปรับฤดูกาล)")
        print(f"  ✓ {'US_CPI':<14} {cpi}%  ({cpi_obs})")
    core, core_obs = bls_yoy("CUUR0000SA0L1E")
    if core is not None:
        put("US_CORE_CPI", core, core_obs,
            "BLS CUUR0000SA0L1E · Core CPI YoY (ไม่รวมอาหารและพลังงาน)")
        print(f"  ✓ {'US_CORE_CPI':<14} {core}%  ({core_obs})")
    un, un_obs = bls_level("LNS14000000")
    if un is not None:
        put("US_UNEMP", un, un_obs, "BLS LNS14000000 · อัตราว่างงาน (ปรับฤดูกาล)")
        print(f"  ✓ {'US_UNEMP':<14} {un}%  ({un_obs})")
 
    # Real yield แบบ ex-post — ไม่ใช่ TIPS breakeven
    # ═══════════════════════════════════════════════════════════════
    # US_REAL10Y เดิมมาจาก FRED DFII10 (TIPS yield จริง) ซึ่งเราเข้าไม่ถึงแล้ว
    # ตัวแทนที่ใช้ได้จริงคือ 10Y − CPI YoY = real yield แบบ ex-post
    # ซึ่งเป็นนิยามที่ใช้กันแพร่หลายและ "หน่วยเป็น %" เหมือนเดิม
    # เกณฑ์ใน computeRegime จึงยังตีความได้ถูก ต่างจาก TIPS ตรงที่ใช้เงินเฟ้อ
    # ที่เกิดขึ้นแล้ว ไม่ใช่ที่ตลาดคาด — บันทึกไว้ใน note ให้ชัด
    if "US10Y" in ylv and cpi is not None:
        rr = round(ylv["US10Y"] - cpi, 2)
        put("US_REAL10Y", rr, cpi_obs,
            "ex-post real yield = ^TNX − CPI YoY · ไม่ใช่ TIPS breakeven")
        print(f"  ✓ {'US_REAL10Y':<14} {rr}%")
 
    # ── 2. สัญญาณรายตัว ────────────────────────────────────────────
    print("── Per-asset signals ────────────────────────")
    # ดึงรายชื่อจาก prices ที่ pipeline เขียนไว้ — ไม่ทำตาราง HOLDINGS ซ้ำ
    # เพิ่ม/ลบสินทรัพย์ที่ fetch_market_data.py ที่เดียว แล้วที่นี่ตามอัตโนมัติ
    sym_of: dict[str, str] = {}
    for tk, p in prices.items():
        src = str((p or {}).get("src") or "")
        if src.startswith("Yahoo "):
            sym_of[tk] = src[6:].strip()
    for tk, sym in [("SP500", "^GSPC"), ("NASDAQ", "^IXIC"), ("SET", "^SET.BK")]:
        sym_of.setdefault(tk, sym)
    # ══════════════════════════════════════════════════════════════
    # kind — แยก "ของที่ถือจริง" ออกจาก "ของอ้างอิง"
    # ══════════════════════════════════════════════════════════════
    # อาการที่ต้องแก้: การ์ด "ควรชะลอ/ลดน้ำหนัก" ขึ้นว่า
    #   AAPL, JEPI, META, NASDAQ
    # NASDAQ เป็นดัชนี ไม่ใช่สิ่งที่ถืออยู่ จะ "ลดน้ำหนัก" ไม่ได้
    #
    # และดัชนียังไปปน breadth ด้วย: SP500 (ดัชนี) + VOO (ETF ที่ตามดัชนีนั้น)
    # + NASDAQ นับเป็น 3 เสียง ทั้งที่เป็นความเสี่ยงก้อนเดียวกันเกือบหมด
    # ทำให้ "% เหนือ MA200" เอียงไปทางตลาดสหรัฐเกินจริง
    #
    # USDT เป็น stablecoin ตรึงที่ 1 ดอลลาร์ — RSI/MA200 ของมันไม่มีความหมาย
    # แต่ถ้านับใน breadth มันจะโหวต "เหนือ MA200" ให้ฟรี ๆ ทุกวัน
    KIND = {"SP500": "index", "NASDAQ": "index", "SET": "index",
            "USDT": "stable"}
 
    charts = parallel_charts([(s, "1y", "1d") for s in set(sym_of.values())])
    signals: dict = {}
    for tk, sym in sorted(sym_of.items()):
        d, v = charts.get(sym, ([], []))
        if len(v) < 30:
            if sym not in charts:
                warn(f"signal: {tk} ({sym}) ไม่มีข้อมูล")
            continue
        m200 = sma(v, 200)
        m50 = sma(v, 50)
        # ไม่มีข้อมูลพอสำหรับ MA200 ≠ อยู่ต่ำกว่า MA200 — ต้องเป็น None
        # ไม่งั้นสินทรัพย์ที่เพิ่ง list จะถูกตีว่า "เทรนด์หัก" ทั้งที่ยังไม่รู้
        trend = None if m200 is None else v[-1] > m200
        r = rsi14(v)
        rp = range_pos(v)
        pos52, dd = rp if rp else (None, None)
        tr, tm, label, why = score_asset(trend, r, dd, pos52)
        e = {
            "sym": sym, "price": round(v[-1], 6), "updated": d[-1],
            "kind": KIND.get(tk, "holding"),
            "rsi": r,
            "ma50": None if m50 is None else ("Above" if v[-1] > m50 else "Below"),
            "ma200": None if trend is None else ("Above" if trend else "Below"),
            "chg1m": pct_change(v, 21), "chg3m": pct_change(v, 63),
            "chg6m": pct_change(v, 126),
            "pos52w": pos52, "drawdown": dd, "vol30d": vol_annual(v, 30),
            # สองแกนแยกกัน — หน้าเว็บแสดงคนละคอลัมน์
            "trend": tr, "timing": tm,
            # score = ผลรวม เก็บไว้ใช้ "เรียงลำดับ" อย่างเดียว
            # ห้ามเอาไปตัดสินป้ายกำกับ — นั่นคือบั๊กที่ v3 เพิ่งแก้
            "score": max(-4, min(4, tr + tm)),
            "action": label, "why": why,
            # sparkline รายสัปดาห์ 26 จุด (~6 เดือน) — เก็บเฉพาะราคา ไม่เก็บ
            # history ดิบทั้งปี ไม่งั้น market-data.json บวมเป็นหลาย MB
            "spark": [round(x, 4) for x in v[::-1][::5][::-1][-26:]],
        }
        signals[tk] = e
        print(f"  ✓ {tk:<10} {label:<16} เทรนด์ {tr:+d} จังหวะ {tm:+d}  "
              f"RSI {r}  MA200 {e['ma200']}  dd {dd}%"
              + ("" if e["kind"] == "holding" else f"  [{e['kind']}]"))
 
    # ══════════════════════════════════════════════════════════════
    # รวมกับสัญญาณรอบก่อน — ตัวที่ดึงไม่ได้รอบนี้ต้อง "แก่ลง" ไม่ใช่ "หายไป"
    # ══════════════════════════════════════════════════════════════
    # บั๊กที่แก้ตรงนี้: fetch_market_data.py สร้าง payload ใหม่ทุกรอบโดยไม่
    # carry บล็อก signals/risk มาด้วย พอ Yahoo ล่มหนึ่งรอบ ไฟล์ที่ commit
    # จะมี signals = {} แล้วหน้าเว็บขึ้นว่า "ต้องรัน fetch_signals.py ก่อน"
    # ทั้งที่เมื่อวานข้อมูลครบและเพิ่งเก่าไปวันเดียว
    #
    # ที่สำคัญกว่า: shared.js มี SIGNAL_MAX_DAYS = 7 พร้อม UI ที่ทำแถวจาง
    # แยกตารางของเก่า และไม่นับรวมในสรุป — โค้ดชุดนั้นไม่มีทางถูกเรียกเลย
    # ถ้าข้อมูลถูกลบทิ้งแทนที่จะแก่ลง
    #
    # merge ราย-ticker แบบเดียวกับที่ prices ทำอยู่แล้วใน fetch_market_data.py
    # ตัวที่ดึงได้รอบนี้ทับของเก่า ตัวที่ดึงไม่ได้คงของเก่าไว้พร้อมวันเดิม
    # (frontend เช็คอายุจาก "updated" เองอยู่แล้ว จึงไม่มีทางเข้าใจผิดว่าเป็นของสด)
    prev_signals = payload.get("signals") or {}
    carried = [k for k in prev_signals if k not in signals]
    merged_signals = {**prev_signals, **signals}
    if carried:
        print(f"  ↻ คงสัญญาณรอบก่อนไว้ {len(carried)} ตัว: "
              f"{', '.join(sorted(carried)[:8])}"
              f"{' …' if len(carried) > 8 else ''}")
 
    # ── 3. ความเสี่ยงระดับตลาด ─────────────────────────────────────
    print("── Market risk ──────────────────────────────")
    def dnum(k):
        e = fresh.get(k) or data.get(k)
        try:
            return float(e["value"])
        except (KeyError, TypeError, ValueError):
            return None
 
    sect = (payload.get("history") or {}).get("sectors") or {}
    sect_up = [s for s in sect.values() if isinstance(s.get("vsMA200"), (int, float))]
    breadth = (round(100 * sum(1 for s in sect_up if s["vsMA200"] > 0) / len(sect_up), 1)
               if sect_up else None)
    # ใช้สัญญาณที่ยัง "ใช้ตัดสินใจได้" เท่านั้น — รวมของรอบก่อนที่ยังไม่เก่าเกิน
    # ต้องตรงกับ SIGNAL_MAX_DAYS ใน shared.js ไม่งั้นตัวเลข breadth บนหน้าเว็บ
    # กับใน block risk จะไม่ตรงกันโดยไม่มีใครเห็น
    usable = [e for e in merged_signals.values()
              if _age_days(e.get("updated")) is not None
              and _age_days(e.get("updated")) <= SIGNAL_MAX_DAYS]
    # breadth ต้องนับเฉพาะ "ของที่ถือจริง" — ไม่รวมดัชนีอ้างอิงกับ stablecoin
    # (ดูเหตุผลที่ KIND ด้านบน) ถ้านับรวม ตัวเลขจะเอียงไปทางตลาดสหรัฐ
    # และได้เสียงฟรีจาก USDT ที่ไม่มีเทรนด์ให้วัดตั้งแต่แรก
    held = [e for e in usable
            if e.get("ma200") is not None
            and e.get("kind", "holding") == "holding"]
    port_up = (round(100 * sum(1 for e in held if e["ma200"] == "Above") / len(held), 1)
               if held else None)
 
    flags: list[dict] = []
    vix = dnum("VIX")
    if vix is not None and vix >= 25:
        flags.append({"k": "vix", "sev": 2 if vix >= 30 else 1,
                      "msg": f"VIX {vix:.1f} — ความผันผวนสูงผิดปกติ"})
    cstr = dnum("CREDIT_STRESS")
    if cstr is not None and cstr >= 1.0:
        flags.append({"k": "credit", "sev": 2 if cstr >= 2 else 1,
                      "msg": f"ความเครียดเครดิต +{cstr:.1f} SD เหนือค่าเฉลี่ย 1 ปี"})
    yc = dnum("YIELD_CURVE")
    if yc is not None and yc < 0:
        flags.append({"k": "curve", "sev": 2 if yc < -50 else 1,
                      "msg": f"Yield curve 2s10s กลับด้าน {yc:.0f} bps"})
    if breadth is not None and breadth <= 30:
        flags.append({"k": "breadth", "sev": 2 if breadth <= 20 else 1,
                      "msg": f"มีเพียง {breadth:.0f}% ของ sector ที่ยังเหนือ MA200"})
    if port_up is not None and port_up <= 40:
        flags.append({"k": "port", "sev": 2 if port_up <= 25 else 1,
                      "msg": f"พอร์ต {100-port_up:.0f}% หลุด MA200 แล้ว"})
 
    sev = sum(f["sev"] for f in flags)
    # ══════════════════════════════════════════════════════════════
    # "ไม่มีข้อมูล" ต้องไม่ถูกรายงานว่า "ปกติ"
    # ══════════════════════════════════════════════════════════════
    # เดิมถ้า Yahoo ล่มทั้งหมด จะไม่มีธงสักอัน → sev = 0 → level = "normal"
    # แล้วหน้าเว็บขึ้นแถบเขียวว่า "ไม่มีสัญญาณเตือนระดับตลาด" ทั้งที่
    # ระบบไม่รู้อะไรเลยสักอย่าง — เป็นการให้ความมั่นใจปลอม ซึ่งอันตราย
    # กว่าการเตือนเกินจริง เพราะคนอ่านจะไม่ไปหาข้อมูลเพิ่มเอง
    #
    # เกณฑ์: ต้องมี "สัญญาณรายตัวที่ยังไม่เก่าเกิน" อย่างน้อยหนึ่งตัว
    #
    # จงใจไม่นับ breadth ของ sector เป็นฐาน ทั้งที่มันก็เป็นข้อมูลตลาด
    # เพราะ history.sectors ใน market-data.json **ไม่มีฟิลด์วันที่เลย**
    # (ดู fetch_market_data.py — entry มีแค่ name/price/chg/rsi/vsMA200)
    # ค่าที่ merge ค้างไว้จากเมื่อไหร่ก็ได้ อาจเก่าเป็นเดือนโดยไม่มีทางรู้
    # ถ้าเอามาเป็นหลักฐานว่า "ตลาดปกติ" ก็เท่ากับเชื่อข้อมูลที่ตรวจอายุไม่ได้
    # — ซึ่งเป็นความผิดแบบเดียวกับที่ทั้งงานนี้พยายามกำจัด
    #
    # breadth ยังใช้ "ติดธงเตือน" ได้ตามปกติ (เตือนเกินจริงเสียหายน้อยกว่า
    # ให้ความมั่นใจปลอม) แต่ลำพังมันอย่างเดียวยืนยันว่าปลอดภัยไม่ได้
    have_basis = bool(held)
    if not have_basis:
        level = "unknown"
        flags = [{"k": "nodata", "sev": 1,
                  "msg": "ไม่มีสัญญาณที่ใช้ได้ — ประเมินความเสี่ยงไม่ได้รอบนี้"}]
        sev = 0
    else:
        level = "high" if sev >= 4 else "elevated" if sev >= 2 else "normal"
    risk = {"level": level, "severity": sev, "flags": flags,
            "breadth_sectors": breadth, "breadth_portfolio": port_up,
            "basis_count": len(held), "computed_at": FETCHED_AT}
    print(f"  ระดับความเสี่ยง: {level} (severity {sev}) · "
          f"breadth sector {breadth}% · พอร์ต {port_up}% เหนือ MA200 "
          f"· ฐานข้อมูล {len(held)} ตัว")
    for f in flags:
        print(f"    ! {f['msg']}")
 
    # ── 4. เขียนกลับ + ล้างค่า FRED ที่ค้าง ─────────────────────────
    data.update(fresh)
    dropped = purge_stale(data, set(fresh))
    payload["data"] = data
    payload["signals"] = merged_signals
    payload["risk"] = risk
    payload["signals_meta"] = {
        "generated_at": FETCHED_AT,
        "count": len(merged_signals),
        "fresh_this_run": len(signals),     # ดึงได้จริงรอบนี้กี่ตัว
        "carried_over": len(carried),       # คงของรอบก่อนไว้กี่ตัว
        "macro_keys": sorted(fresh),
        "dropped_stale_fred": dropped,
        "warnings": warnings,
        "version": "signals v3",
    }
    with open(MD, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
 
    if dropped:
        print(f"  🗑  ลบค่า FRED ที่ค้างตั้งแต่ ก.ค. {len(dropped)} key: "
              f"{', '.join(dropped)}")
 
    # ── 5. snapshot รายวันสำหรับ backtest ──────────────────────────
    # เก็บตั้งแต่วันแรก ไม่ใช่ค่อยมาเพิ่มทีหลัง — ข้อมูลย้อนหลังของ "สัญญาณ"
    # ซื้อคืนไม่ได้ ต่อให้ราคาย้อนหลังหาได้ เพราะเกณฑ์อาจเปลี่ยนไปแล้ว
    hist = {"schema": 2, "days": {}}
    if os.path.exists(HIST):
        try:
            with open(HIST, encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded.get("days"), dict):
                hist = loaded
        except (json.JSONDecodeError, OSError) as e:
            warn(f"อ่าน {HIST} ไม่ได้ ({e}) — เริ่มไฟล์ใหม่")
 
    hist["days"][TODAY] = {
        "macro": {k: fresh[k]["value"] for k in sorted(fresh)},
        "risk": {"level": level, "severity": sev,
                 "breadth": breadth, "port_breadth": port_up},
        # เก็บเฉพาะ 3 ค่าต่อสินทรัพย์ — ราคา/RSI/คะแนน พอสำหรับ backtest
        # ว่า "ถ้าทำตามสัญญาณวันนั้นแล้วผลเป็นอย่างไร" และทำให้ไฟล์โตช้า
        #
        # ใช้ `signals` (ดึงได้จริงรอบนี้) ไม่ใช่ `merged_signals` โดยเจตนา
        # ตัวที่ carry มาจากรอบก่อนเป็นข้อมูลของ "วันก่อน" ถ้าบันทึกซ้ำลงวันนี้
        # จะกลายเป็นการสร้างจุดข้อมูลปลอม แล้ว backtest จะเห็นราคาค้างนิ่ง
        # หลายวันติดกันเหมือนตลาดไม่เคลื่อนไหว ซึ่งบิดเบือนผลทดสอบ
        # วันที่ดึงไม่ได้ควรเป็น "ช่องว่าง" ในประวัติ ไม่ใช่ค่าที่ลอกมา
        #
        # schema 2 — เก็บ [ราคา, RSI, เทรนด์, จังหวะ] แทน [ราคา, RSI, คะแนนรวม]
        # เพราะ backtest ต้องตอบได้ว่า "กฎไหนได้ผล" ไม่ใช่แค่ "คะแนนรวมได้ผลไหม"
        # ถ้าเก็บแต่ผลรวม จะแยกไม่ออกว่าที่กำไรเพราะเลือกตามเทรนด์หรือตามจังหวะ
        # แถวของ schema 1 มี 3 ช่อง แถวใหม่มี 4 — ตัวอ่านต้องดูความยาวก่อน
        "assets": {k: [v["price"], v["rsi"], v["trend"], v["timing"]]
                   for k, v in signals.items()},
    }
    if len(hist["days"]) > HIST_MAX_DAYS:
        for old in sorted(hist["days"])[:len(hist["days"]) - HIST_MAX_DAYS]:
            hist["days"].pop(old, None)
    # ไฟล์เดิมอาจเป็น schema 1 — ยกเลขขึ้นตอนเขียน เพราะตั้งแต่วันนี้ไป
    # แถวใหม่เป็นรูปแบบ 4 ช่อง แถวเก่าที่มี 3 ช่องยังอยู่ในไฟล์เหมือนเดิม
    # (ตัวอ่านดูความยาวของแถวเอง ไม่ใช่ดูเลข schema อย่างเดียว)
    hist["schema"] = 2
    hist["updated_at"] = FETCHED_AT
    with open(HIST, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
 
    print("─────────────────────────────────────────────")
    print(f"เขียน {MD}: macro {len(fresh)} keys · signals {len(signals)} ตัว · "
          f"risk {level} · ลบค่าค้าง {len(dropped)} key")
    print(f"เขียน {HIST}: {len(hist['days'])} วัน "
          f"({os.path.getsize(HIST)/1024:.0f} KB)")
    if warnings:
        print(f"  {len(warnings)} warnings")
 
    # เกณฑ์ fail: ถ้าไม่ได้ macro เลย หรือได้สัญญาณน้อยกว่าครึ่งของที่ควรได้
    # แปลว่ามีอะไรผิดปกติจริง ไม่ใช่แค่ symbol เดียวล่ม — ไฟล์ถูกเขียนไปแล้ว
    # (ของเดิมยังอยู่ครบ) แต่ workflow ต้องไม่รายงานว่าสำเร็จ
    if not fresh:
        print("::error::ไม่ได้ค่า macro เลยรอบนี้ — ตรวจสอบ warnings ด้านบน")
        return 1
    if sym_of and len(signals) < len(sym_of) / 2:
        print(f"::error::ได้สัญญาณแค่ {len(signals)}/{len(sym_of)} ตัว")
        return 1
    return 0
 
 
if __name__ == "__main__":
    sys.exit(main())
