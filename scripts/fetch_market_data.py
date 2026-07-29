#!/usr/bin/env python3
"""
Finance OS — Market Data Pipeline
═════════════════════════════════════════════════════════════════════
Extract : FRED (keyless CSV) + Yahoo Finance (keyless chart API)
Transform: YoY %, MoM change, RSI(14), MA200, spread, momentum
Load    : market-data.json  (dashboard fetch same-origin — ไม่ติด CORS)

รันโดย GitHub Actions ทุกเช้า 06:30 (ดู .github/workflows/market-data.yml)

หลักการ: ทุก series ห่อ try/except แยกกัน — ตัวไหนล้มตัวอื่นไปต่อ
         และ log ✓/✗ ทุกตัว เพื่อให้เห็นใน Actions log ว่าอะไรได้/ไม่ได้
         (series ID ของ FRED ฝั่งไทยไม่เสถียร — บางตัวถูก discontinue)
"""
import json, sys, urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (FinanceOS personal dashboard; +github pages)"}
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
out, history = {}, {}
ok_count = fail_count = 0


def put(key, value, updated=None, note=""):
    global ok_count
    out[key] = {"value": value, "updated": updated or TODAY, "note": note}
    ok_count += 1
    print(f"  ✓ {key:<16} = {value}  ({note})")


def skip(key, why):
    global fail_count
    fail_count += 1
    print(f"  ✗ {key:<16} — {why}")


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


# ── FRED: keyless CSV ────────────────────────────────────────────────
def fred(series_id, last_n=400):
    csv = fetch(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}")
    rows = []
    for line in csv.strip().splitlines()[1:]:
        parts = line.split(",")
        if len(parts) < 2:
            continue
        d, v = parts[0], parts[1]
        if v not in (".", ""):
            rows.append((d, float(v)))
    if not rows:
        raise ValueError("empty series")
    return rows[-last_n:]


def fred_first(series_ids, last_n=400):
    """ลอง series หลายตัวตามลำดับ — FRED ฝั่งไทยมักถูก discontinue"""
    errs = []
    for sid in series_ids:
        try:
            return fred(sid, last_n), sid
        except Exception as e:
            errs.append(f"{sid}: {type(e).__name__}")
    raise ValueError("ทุก series ล้ม → " + "; ".join(errs))


def yoy(rows, periods=12):
    """YoY % — periods=12 รายเดือน, 4 รายไตรมาส"""
    if len(rows) < periods + 1:
        raise ValueError("series สั้นเกิน")
    d, latest = rows[-1]
    _, prev = rows[-1 - periods]
    return round((latest / prev - 1) * 100, 1), d


# ── Yahoo: keyless chart API ─────────────────────────────────────────
def yahoo(symbol, range_="1y", interval="1d"):
    j = json.loads(fetch(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?range={range_}&interval={interval}"))
    res = j["chart"]["result"][0]
    closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
    if not closes:
        raise ValueError("no closes")
    return closes


def yahoo_weekly_history(symbol, range_="5y"):
    j = json.loads(fetch(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?range={range_}&interval=1wk"))
    res = j["chart"]["result"][0]
    out_ = []
    for t, c in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if c:
            out_.append([datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"),
                         round(c, 3)])
    return out_


def rsi14(closes):
    """Wilder's RSI(14) — มาตรฐานเดียวกับ TradingView"""
    if len(closes) < 15:
        raise ValueError("not enough data")
    gains, losses = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        gains.append(max(ch, 0)); losses.append(max(-ch, 0))
    ag = sum(gains[:14]) / 14; al = sum(losses[:14]) / 14
    for i in range(14, len(gains)):
        ag = (ag * 13 + gains[i]) / 14
        al = (al * 13 + losses[i]) / 14
    return 100.0 if al == 0 else round(100 - 100 / (1 + ag / al), 0)


def pct_change(closes, days):
    if len(closes) <= days:
        raise ValueError("short")
    return round((closes[-1] / closes[-1 - days] - 1) * 100, 2)


def run():
    # ══ 1) FRED — นโยบาย/เงินเฟ้อ/พันธบัตร/เครดิต ══════════════════
    print("── FRED: US macro ──")
    for key, sids, kind, note in [
        ("FED_RATE",      ["DFEDTARU"],                 "level",  "Fed target upper bound"),
        ("US10Y",         ["DGS10"],                    "level",  "10Y Treasury"),
        ("US2Y",          ["DGS2"],                      "level",  "2Y Treasury"),
        ("VIX",           ["VIXCLS"],                   "level",  "VIX"),
        ("CREDIT_SPREAD", ["BAMLH0A0HYM2"],             "level",  "HY OAS"),
        ("US_UNEMP",      ["UNRATE"],                   "level",  "US unemployment %"),
        ("US_REAL10Y",    ["DFII10"],                   "level",  "10Y TIPS real yield"),
        ("OIL_WTI",       ["DCOILWTICO"],               "level",  "WTI crude $/bbl"),
        ("US_CPI",        ["CPIAUCSL"],                 "yoy12",  "CPI YoY"),
        ("US_CORE_CPI",   ["CPILFESL"],                 "yoy12",  "Core CPI YoY"),
        ("US_PCE",        ["PCEPI"],                    "yoy12",  "PCE YoY"),
        ("US_CORE_PCE",   ["PCEPILFE"],                 "yoy12",  "Core PCE YoY"),
        ("US_GDP",        ["A191RL1Q225SBEA"],          "level",  "Real GDP QoQ SAAR"),
    ]:
        try:
            rows, used = fred_first(sids)
            if kind == "level":
                put(key, rows[-1][1], rows[-1][0], f"FRED {used}: {note}")
            else:
                v, d = yoy(rows, 12)
                put(key, v, d, f"FRED {used}: {note}")
        except Exception as e:
            skip(key, str(e)[:90])

    # NFP = การจ้างงานเปลี่ยนแปลง MoM (พันตำแหน่ง)
    try:
        rows, used = fred_first(["PAYEMS"])
        put("NFP", round(rows[-1][1] - rows[-2][1]), rows[-1][0], f"FRED {used}: MoM change (K)")
    except Exception as e:
        skip("NFP", str(e)[:90])

    # Yield curve 2s10s
    try:
        t10 = out.get("US10Y", {}).get("value")
        t2 = out.get("US2Y", {}).get("value")
        if t10 is None or t2 is None:
            raise ValueError("ต้องมี US10Y และ US2Y ก่อน")
        put("YIELD_CURVE", round((t10 - t2) * 100), out["US10Y"]["updated"], "2s10s spread (bps)")
    except Exception as e:
        skip("YIELD_CURVE", str(e)[:90])

    # ══ 2) FRED — ไทย (series ID ไม่เสถียร ลองหลายตัว) ═══════════════
    print("── FRED: Thailand macro ──")
    try:
        rows, used = fred_first(["THACPIALLMINMEI", "CPALTT01THM661N", "CPALTT01THQ661N"])
        v, d = yoy(rows, 12 if len(rows) > 24 else 4)
        put("TH_CPI", v, d, f"FRED {used}: CPI YoY")
    except Exception as e:
        skip("TH_CPI", str(e)[:90] + " → ใส่มือในชีต")
    try:
        rows, used = fred_first(["IR3TIB01THM156N", "INTDSRTHM193N"])
        put("BOT_RATE", round(rows[-1][1], 2), rows[-1][0], f"FRED {used}: ดอกเบี้ยไทย (proxy)")
    except Exception as e:
        skip("BOT_RATE", str(e)[:90] + " → ใส่มือในชีต")
    try:
        rows, used = fred_first(["NGDPRSAXDCTHQ", "CLVMNACSCAB1GQTH"])
        v, d = yoy(rows, 4)
        put("TH_GDP", v, d, f"FRED {used}: Real GDP YoY")
    except Exception as e:
        skip("TH_GDP", str(e)[:90] + " → ใส่มือในชีต")

    # ══ 3) Yahoo — ดัชนี/ทอง/ค่าเงิน ════════════════════════════════
    print("── Yahoo: indices & commodities ──")
    for key, sym, note, fmt in [
        ("SP500",     "%5EGSPC",   "S&P 500",        0),
        ("NASDAQ",    "%5EIXIC",   "Nasdaq Composite", 0),
        ("SET_INDEX", "%5ESET.BK", "SET Index",      2),
        ("GOLD_XAU",  "GC%3DF",    "Gold futures ≈ spot", 1),
        ("USDTHB",    "THB%3DX",   "USD/THB",        2),
        ("DXY",       "DX-Y.NYB",  "Dollar Index",   2),
    ]:
        try:
            closes = yahoo(sym, "6mo")
            put(key, round(closes[-1], fmt), TODAY, f"Yahoo {note}")
            # % เปลี่ยนวันล่าสุด (ใช้กับการ์ด SP500_CHG)
            if key == "SP500" and len(closes) > 1:
                put("SP500_CHG", round((closes[-1] / closes[-2] - 1) * 100, 2), TODAY, "Yahoo daily %")
        except Exception as e:
            skip(key, str(e)[:90])

    # ══ 4) Technicals — RSI + MA200 ═════════════════════════════════
    print("── Technicals ──")
    for key_rsi, key_ma, sym, label in [
        ("SP500_RSI", "SP500_MA200", "%5EGSPC",   "^GSPC"),
        ("SET_RSI",   "SET_MA200",   "%5ESET.BK", "^SET.BK"),
        ("NDX_RSI",   "NDX_MA200",   "%5EIXIC",   "^IXIC"),
    ]:
        try:
            closes = yahoo(sym, "1y")
            put(key_rsi, rsi14(closes), TODAY, f"Yahoo {label} RSI(14)")
            if len(closes) >= 200:
                ma = sum(closes[-200:]) / 200
                put(key_ma, "Above" if closes[-1] > ma else "Below", TODAY,
                    f"close {closes[-1]:,.1f} vs MA200 {ma:,.1f}")
        except Exception as e:
            skip(key_rsi, str(e)[:90])

    # ══ 5) Sector momentum — ทำให้หน้า Sectors สดจริง ═══════════════
    print("── Sector ETFs (momentum) ──")
    SECTORS = [
        ("Technology",      "XLK"), ("Healthcare",  "XLV"), ("Financials", "XLF"),
        ("Cons. Disc.",     "XLY"), ("Cons. Staples","XLP"), ("Industrials","XLI"),
        ("Energy",          "XLE"), ("Utilities",   "XLU"), ("Real Estate","XLRE"),
        ("Materials",       "XLB"),
    ]
    sectors = {}
    for name, sym in SECTORS:
        try:
            closes = yahoo(sym, "1y")
            ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
            sectors[sym] = {
                "name": name,
                "price": round(closes[-1], 2),
                "chg1m": pct_change(closes, 21),
                "chg3m": pct_change(closes, 63),
                "rsi": rsi14(closes),
                "vsMA200": (None if ma200 is None else
                            round((closes[-1] / ma200 - 1) * 100, 1)),
            }
            print(f"  ✓ {sym:<6} {name:<16} 1M {sectors[sym]['chg1m']:+6.2f}%  "
                  f"3M {sectors[sym]['chg3m']:+6.2f}%  RSI {sectors[sym]['rsi']:.0f}")
        except Exception as e:
            print(f"  ✗ {sym:<6} {str(e)[:60]}")
    if sectors:
        # เทียบกับ SPY เพื่อหา relative strength
        try:
            spy = yahoo("SPY", "1y")
            spy1m, spy3m = pct_change(spy, 21), pct_change(spy, 63)
            for s in sectors.values():
                s["rs1m"] = round(s["chg1m"] - spy1m, 2)
                s["rs3m"] = round(s["chg3m"] - spy3m, 2)
            print(f"  ✓ relative strength vs SPY (1M {spy1m:+.2f}% · 3M {spy3m:+.2f}%)")
        except Exception as e:
            print(f"  ✗ SPY benchmark: {str(e)[:60]}")
        history["sectors"] = sectors

    # ══ 6) Price history — ใช้กับ benchmark simulation ═══════════════
    print("── Benchmark history (weekly 5y) ──")
    for key, sym in [("SP500", "%5EGSPC"), ("USDTHB", "THB%3DX")]:
        try:
            history[key] = yahoo_weekly_history(sym)
            print(f"  ✓ {key} history: {len(history[key])} weeks")
        except Exception as e:
            print(f"  ✗ {key} history: {str(e)[:70]}")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "github-actions pipeline (FRED + Yahoo)",
        "data": out,
        "history": history,
    }
    with open("market-data.json", "w") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"\n→ market-data.json: {len(out)} keys · sectors {len(history.get('sectors',{}))}"
          f" · ✓{ok_count} ✗{fail_count}")
    if len(out) == 0:
        sys.exit(1)   # ทุก series ล้ม = อย่า commit ไฟล์ว่างทับของดี


if __name__ == "__main__":
    run()
