#!/usr/bin/env python3
"""
การทดลองแบบมีตัวแปรควบคุม: FRED บล็อกที่ IP หรือที่ User-Agent?
────────────────────────────────────────────────────────────────────────
ทำไมต้องมีไฟล์นี้:

  20 ก.ย. ผมรัน probe_sources.py แล้ว FRED timeout 15.14s จึงสรุปว่า
  "FRED บล็อก IP ของ GitHub Actions" แล้วเอาข้อสรุปนั้นไปออกแบบทั้งระบบ
  (ใช้ ^IRX แทน FED_RATE · z-score HYG/IEF แทน HY OAS · real yield แบบ ex-post)

  21 ก.ย. log ของ workflow เดิมกลับแสดงว่า FRED ตอบ 200 ใน 0.2 วินาที
  ตัวแปรเดียวที่ต่างคือ User-Agent:

    ใช้ได้   FinanceOS-pipeline/42              (ไม่มีคำว่า Mozilla)
    ล้ม      Mozilla/5.0 (compatible; FinanceOS-probe/1)    ← ของผม
    ล้ม      Mozilla/5.0 (Macintosh ... Chrome/126 ...)

  ผมตั้งชื่อตัวแปรว่า UA_BOT แล้วใส่ค่าที่ขึ้นต้นด้วย Mozilla/5.0
  พอมัน timeout ก็โทษ IP ทั้งที่เหตุอยู่ที่ค่าที่ผมเลือกเอง

บทเรียนที่ไฟล์นี้บังคับใช้: ถ้าจะสรุปว่า "X ทำให้เกิด Y" ต้องเปลี่ยน X
อย่างเดียวโดยตรึงทุกอย่างที่เหลือ และต้องซ้ำมากกว่าหนึ่งครั้ง

การออกแบบ:
  • URL เดียว · UA 6 แบบ · ซ้ำ 4 รอบ (เหตุผลของเลข 4 อยู่ที่ ROUNDS ด้านล่าง)
  • สลับลำดับ UA ในแต่ละรอบด้วย seed คงที่ — กันผลจาก "ตัวแรกโดน cold start"
    และกัน rate-limit สะสมไปตกที่ UA ตัวท้ายเสมอ
  • มีกลุ่มควบคุม (Yahoo) ยิงด้วย UA ชุดเดียวกัน ถ้า Yahoo ก็ล้มตาม UA ด้วย
    แปลว่าเป็นปัญหาเครือข่าย ไม่ใช่ FRED กรอง UA
  • ถ้าผ่าน จะลองดึง series จริงที่ระบบต้องใช้ทั้ง 7 ตัว ไม่ใช่แค่ DGS10
    เพราะ FRED อาจเปิดบาง endpoint แต่ปิดบางตัว

  python3 scripts/probe_fred_ua.py

ไม่เขียนไฟล์ ไม่แตะ market-data.json ไม่ส่ง LINE
"""
import random
import ssl
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

CTX = ssl.create_default_context()
TIMEOUT = 12
# ══════════════════════════════════════════════════════════════════════
# ทำไม 4 รอบ ไม่ใช่ 3
# ══════════════════════════════════════════════════════════════════════
# ถ้า FRED ไม่ได้กรอง UA เลยแต่แค่ "แกว่ง" ที่อัตราสำเร็จ 50%
# โอกาสที่ UA ตัวหนึ่งจะผ่านครบโดยบังเอิญ = 0.5^n
#   n=3 → 12.5% ต่อตัว · มี 6 ตัว → โอกาสเจออย่างน้อยหนึ่งตัว ~55%
#   n=4 →  6.3% ต่อตัว · มี 6 ตัว → ~32%
# ยังไม่ปลอดภัยพอถ้าดูแค่ "มี UA ที่ผ่านครบไหม" — จึงต้องดู *รูปแบบ*
# ของการผ่าน/ล้มว่าแบ่งตามเส้น Mozilla/ไม่-Mozilla พอดีหรือไม่ด้วย
# (โค้ดส่วนตีความด้านล่างบังคับเงื่อนไขนี้ก่อนจะสรุปว่าเป็นเรื่อง UA)
ROUNDS = 4
SEED = 20260921          # ตรึง seed ให้รันซ้ำได้ผลลำดับเดิม

# ══════════════════════════════════════════════════════════════════════
# ตัวแปรต้น — User-Agent  (ตรึงทุกอย่างที่เหลือ: URL · timeout · header อื่น)
# ══════════════════════════════════════════════════════════════════════
UAS = [
    ("plain-token",   "FinanceOS-pipeline/42"),
    ("mozilla-compat", "Mozilla/5.0 (compatible; FinanceOS-probe/1)"),   # ของผม
    ("chrome-full",   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/126.0.0.0 Safari/537.36"),
    ("urllib-default", None),        # ไม่ตั้ง header เลย → Python-urllib/3.x
    ("curl-like",     "curl/8.5.0"),
    ("empty",         ""),           # ตั้งเป็นสตริงว่าง
]

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
# กลุ่มควบคุม: host ที่รู้อยู่แล้วว่าใช้ได้ ยิงด้วย UA ชุดเดียวกัน
CTRL_URL = ("https://query1.finance.yahoo.com/v8/finance/chart/"
            "%5EVIX?range=5d&interval=1d")

# series ที่ระบบอยากได้คืนถ้า FRED ใช้ได้จริง
SERIES = [
    ("DFEDTARU",      "Fed funds target upper — ดอกเบี้ยนโยบายตัวจริง"),
    ("BAMLH0A0HYM2",  "HY OAS — credit spread ตัวจริง (หน่วย %)"),
    ("DFII10",        "TIPS 10Y real yield ตัวจริง"),
    ("DGS10",         "10Y Treasury"),
    ("DGS2",          "2Y Treasury"),
    ("CPIAUCSL",      "CPI (ดัชนี ต้องคำนวณ YoY เอง)"),
    ("UNRATE",        "อัตราว่างงาน"),
]


def get(url, ua):
    """คืน (ผล, วินาที, ไบต์, บรรทัดแรก) — ไม่ throw

    ua = None แปลว่าไม่ตั้ง header เลย (urllib ใส่ Python-urllib/3.x ให้)
    """
    t0 = time.monotonic()
    req = urllib.request.Request(url)
    if ua is not None:
        req.add_header("User-Agent", ua)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
            body = r.read()
            first = body.decode("utf-8", "replace").split("\n", 1)[0][:60]
            return f"OK {r.status}", time.monotonic() - t0, len(body), first
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}", time.monotonic() - t0, 0, ""
    except Exception as e:                                       # noqa: BLE001
        return type(e).__name__, time.monotonic() - t0, 0, str(e)[:60]


def run_matrix(name, url):
    """ยิง url ด้วยทุก UA ซ้ำ ROUNDS รอบ สลับลำดับในแต่ละรอบ"""
    rng = random.Random(SEED)
    res = defaultdict(list)
    print(f"\n┌─ {name} ─────────────────────────────────────")
    print(f"│  {url[:66]}")
    for rd in range(1, ROUNDS + 1):
        order = UAS[:]
        rng.shuffle(order)
        print(f"│  รอบ {rd}  (ลำดับ: {', '.join(k for k, _ in order)})")
        for key, ua in order:
            st, dt, n, first = get(url, ua)
            res[key].append((st, dt, n))
            ok = st.startswith("OK")
            print(f"│    {'✓' if ok else '✗'} {key:<16} {st:<14} "
                  f"{dt:5.2f}s {n:>8,}B  {first}")
            time.sleep(0.5)          # เว้นจังหวะ กัน rate-limit เทียม
    print("└──────────────────────────────────────────────")
    return res


def summarize(name, res):
    print(f"\n  สรุป {name} — ผ่านกี่ครั้งจาก {ROUNDS}")
    verdict = {}
    for key, _ in UAS:
        runs = res[key]
        ok = sum(1 for st, _, _ in runs if st.startswith("OK"))
        avg = sum(d for _, d, _ in runs) / len(runs) if runs else 0
        sts = {st for st, _, _ in runs}
        verdict[key] = ok
        print(f"    {key:<16} {ok}/{ROUNDS}  เฉลี่ย {avg:5.2f}s  "
              f"{'·'.join(sorted(sts))}")
    return verdict


def main():
    now = datetime.now(timezone.utc)
    print("═" * 70)
    print(f"FRED — การทดลองแยกตัวแปร User-Agent · {now:%Y-%m-%d %H:%M} UTC")
    print(f"python {sys.version.split()[0]} · timeout {TIMEOUT}s · "
          f"{len(UAS)} UA × {ROUNDS} รอบ")
    print("═" * 70)

    fred = run_matrix("FRED", FRED_URL)
    ctrl = run_matrix("กลุ่มควบคุม (Yahoo ^VIX)", CTRL_URL)

    print("\n" + "═" * 70)
    print("ผลการทดลอง")
    print("═" * 70)
    vf = summarize("FRED", fred)
    vc = summarize("Yahoo", ctrl)

    # ── ตีความ ────────────────────────────────────────────────────
    print("\n  ตีความ")
    ctrl_all_ok = all(v == ROUNDS for v in vc.values())
    fred_any_ok = any(v > 0 for v in vf.values())
    fred_all_ok = all(v == ROUNDS for v in vf.values())

    if not ctrl_all_ok:
        # กลุ่มควบคุมล้ม = ห้ามสรุปอะไรเกี่ยวกับ FRED จากรอบนี้
        bad = [k for k, v in vc.items() if v < ROUNDS]
        print(f"    ⚠ กลุ่มควบคุมล้มด้วย UA: {', '.join(bad)}")
        print("      แปลว่าเครือข่ายหรือ UA มีผลกับทุก host ไม่ใช่เฉพาะ FRED")
        print("      ห้ามสรุปเรื่อง FRED จากรอบนี้ — ต้องรันซ้ำ")
    elif not fred_any_ok:
        print("    ✗ FRED ล้มทุก UA ขณะที่ Yahoo ผ่านทุก UA")
        print("      → บล็อกที่ IP จริง ข้อสรุปเดิมของ v44 ถูกต้อง")
        print("      → เก็บ proxy ไว้ตามเดิม (US3M · CREDIT_STRESS · ex-post real yield)")
    elif fred_all_ok:
        print("    ? FRED ผ่านทุก UA รวมถึงตัวที่เคยล้ม")
        print("      → ไม่ใช่เรื่อง UA แต่เป็นความไม่เสถียรของ FRED เอง")
        print("      → ถ้าจะใช้ ต้องมี fallback และห้ามให้ pipeline พังตามมัน")
    else:
        good = [k for k, v in vf.items() if v == ROUNDS]
        bad = [k for k, v in vf.items() if v == 0]
        mixed = [k for k, v in vf.items() if 0 < v < ROUNDS]
        print(f"    ✓ ผ่านทุกรอบ : {', '.join(good) or '(ไม่มี)'}")
        print(f"    ✗ ล้มทุกรอบ  : {', '.join(bad) or '(ไม่มี)'}")
        if mixed:
            print(f"    ~ ไม่แน่นอน   : {', '.join(mixed)}  ← ใช้ไม่ได้ ต้องเสถียรทุกรอบ")
        # ── เงื่อนไขก่อนสรุปว่า "เป็นเรื่อง UA" ────────────────────
        # แค่ "มี UA ที่ผ่านครบ" ยังไม่พอ — FRED ที่แกว่ง 50% ก็ให้ผลแบบนั้นได้
        # ต้องเห็นรูปแบบที่แบ่งตามเส้น Mozilla/ไม่-Mozilla พอดีด้วย
        # ถ้าแบ่งไม่ลงตัว = ผลนี้อธิบายด้วย UA ไม่ได้ ต้องบอกตรง ๆ ว่ายังสรุปไม่ได้
        has_moz = lambda k: "mozilla" in k or "chrome" in k           # noqa: E731
        clean_split = (good and bad
                       and all(not has_moz(k) for k in good)
                       and all(has_moz(k) for k in bad)
                       and not mixed)
        if clean_split:
            print("\n    → FRED กรองที่ User-Agent ไม่ใช่ IP")
            print("      UA ที่อ้างว่าเป็นเบราว์เซอร์ถูกปฏิเสธ · UA แบบ bot ผ่าน")
            print("      ข้อสรุปเดิมของผม (และของ v44) ผิด")
        else:
            print("\n    → ยังสรุปไม่ได้ว่าเป็นเรื่อง UA")
            moz_bad = [k for k in bad if has_moz(k)]
            non_moz_bad = [k for k in bad if not has_moz(k)]
            moz_good = [k for k in good if has_moz(k)]
            if non_moz_bad:
                print(f"      UA ที่ไม่ใช่เบราว์เซอร์ก็ล้มด้วย: {', '.join(non_moz_bad)}")
            if moz_good:
                print(f"      UA แบบเบราว์เซอร์กลับผ่าน: {', '.join(moz_good)}")
            if mixed:
                print(f"      มี UA ที่ผลไม่คงที่: {', '.join(mixed)}")
            print("      รูปแบบนี้เข้ากับ 'FRED ไม่เสถียร' มากกว่า 'FRED กรอง UA'")
            print(f"      ({ROUNDS} รอบยังน้อยเกินจะแยกสองอย่างนี้ — ถ้าจะใช้ FRED จริง")
            print("       ต้องออกแบบให้ทนการล้มเป็นครั้งคราวไม่ว่าสาเหตุคืออะไร)")
            _ = moz_bad

    # ── ถ้ามี UA ที่เสถียร ลอง series จริงที่ระบบต้องใช้ ──────────────
    winner = next((k for k, v in vf.items() if v == ROUNDS), None)
    if winner and ctrl_all_ok:
        ua = dict(UAS)[winner]
        print(f"\n┌─ ลอง series จริงด้วย UA '{winner}' ─────────────")
        print("│  (endpoint เดียวผ่าน ไม่ได้แปลว่าทุก series ผ่าน)")
        okc = 0
        for sid, what in SERIES:
            st, dt, n, first = get(
                f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}", ua)
            ok = st.startswith("OK") and n > 100
            okc += ok
            print(f"│  {'✓' if ok else '✗'} {sid:<14} {st:<12} {dt:5.2f}s "
                  f"{n:>8,}B  {what}")
            time.sleep(0.5)
        print("└──────────────────────────────────────────────")
        print(f"\n  series ที่ใช้ได้: {okc}/{len(SERIES)}")
        if okc == len(SERIES):
            print("    → เอาของจริงกลับมาได้ทั้ง FED_RATE · HY OAS · TIPS real yield")
        elif okc:
            print("    → ได้บางตัว ต้องเลือกเฉพาะตัวที่ผ่าน ที่เหลือใช้ proxy ต่อ")

    print("═" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
