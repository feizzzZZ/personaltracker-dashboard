#!/usr/bin/env python3
"""
Finance OS — LINE notifier  (v1)
────────────────────────────────────────────────────────────────────────
ส่งสรุปพอร์ต / เตือนราคาผิดปกติ เข้า LINE ผ่าน Messaging API

ทำไมไม่ใช่ LINE Notify: ปิดบริการไปแล้ว 31 มี.ค. 2025
ทำไมไม่ยิงจาก index.html: Channel Access Token อยู่ฝั่ง client = ใครก็ส่ง
   ข้อความในนามบอทได้  ตัวส่งจึงต้องอยู่ใน CI ที่ token ถูกเก็บเป็น secret

รันหลัง fetch_market_data.py เสมอ — อ่าน market-data.json ที่เพิ่งเขียน

  python3 scripts/line_notify.py --mode daily
  python3 scripts/line_notify.py --mode alert     # ส่งเฉพาะเมื่อมีอะไรผิดปกติ
  python3 scripts/line_notify.py --mode weekly
  python3 scripts/line_notify.py --mode monthly
  python3 scripts/line_notify.py --mode daily --dry-run   # พิมพ์อย่างเดียว ไม่ส่ง

ENV ที่ต้องมี
  LINE_CHANNEL_TOKEN   Channel Access Token (long-lived) จาก LINE Developers
  GS_SHEET_ID          (ไม่บังคับ) รหัสชีต — ถ้าไม่ใส่จะส่งได้แค่ข่าวตลาด
  GOOGLE_SA_KEY        (ไม่บังคับ) service-account JSON ทั้งก้อน สำหรับอ่านชีต

หลักการเดียวกับ pipeline: ถ้าอะไรล้ม ให้เงียบและส่งเท่าที่มี — ดีกว่าไม่ส่งเลย
แต่ถ้า "ไม่มีอะไรจะส่ง" ต้องไม่ส่งข้อความเปล่า เพราะโควตาฟรีมีแค่ 200/เดือน
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=7))                 # Asia/Bangkok
NOW = datetime.now(TZ)
MARKET = os.environ.get("MARKET_DATA_OUT", "market-data.json")
STATE = os.environ.get("NOTIFY_STATE", "notify-state.json")

TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
          "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]


def th_date(d: datetime) -> str:
    # ใช้ ค.ศ. ให้ตรงกับที่ dashboard แสดง (แอปเคยมีบั๊ก "2569" มาก่อน — อย่าสร้างซ้ำ)
    return f"{d.day} {TH_MON[d.month - 1]} {d.year}"


def money(v: float) -> str:
    return f"฿{v:,.0f}"


def signed(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}฿{abs(v):,.0f}"


def pct(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}{abs(v):.2f}%"


# ══════════════════════════════════════════════════════════════════════
# 1. market-data.json
# ══════════════════════════════════════════════════════════════════════
def load_market() -> dict:
    try:
        with open(MARKET, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"⚠️  อ่าน {MARKET} ไม่ได้: {e}", file=sys.stderr)
        return {}


def load_state() -> dict:
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(st: dict) -> None:
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)


# ══════════════════════════════════════════════════════════════════════
# 2. Asset_Tracker — พอร์ตจริง  (ตรรกะเดียวกับ gsParseAssetTracker ใน index.html)
# ══════════════════════════════════════════════════════════════════════
# ถ้าสองที่นี้คำนวณไม่ตรงกัน ตัวเลขใน LINE จะขัดกับ dashboard ซึ่งแย่กว่าไม่ส่งเลย
# จึง port มาตรงๆ ทุกบรรทัด รวมทั้งชื่อคอลัมน์ที่สะกดผิดในชีต (Quatity/Total_Amout_THB)
SIGN = {"Buy": 1, "Split": 1, "Recieved": 1, "Stake": 1,
        "Sell": -1, "Send": -1, "Used": -1,
        "Transfer": 0, "Dividend Payout": 0}
IS_COST = {"Buy", "Split"}
TM = {"Thai_Stock": "หุ้นไทย", "US_Stock": "หุ้น US", "Cryptocurrency": "คริปโต",
      "Mutual_Fund": "กองทุนรวม", "Provident_Fund": "กองทุนสำรองฯ", "Gold": "ทอง"}
CRYPTO_TICKERS = {"BTC", "ETH", "BNB", "USDT", "USDC", "KUB", "DOGE", "XRP", "ADA",
                  "SOL", "DOT", "MATIC", "AVAX", "LINK", "NEAR", "ATOM", "OP", "ARB",
                  "SAND", "GALA", "JFIN", "SIX", "BUSD"}
CRYPTO_PLATFORM = ("binance", "okx", "bitkub", "bitazza", "coinbase", "kraken",
                   "bybit", "kucoin", "upbit", "satang", "zipmex", "metamask",
                   "ledger", "wallet")


def resolve_group(asset_type, ticker, platform) -> str:
    t = (asset_type or "").strip()
    if t in TM:
        return TM[t]
    if (ticker or "").strip().upper() in CRYPTO_TICKERS:
        return "คริปโต"
    p = (platform or "").lower()
    if any(k in p for k in CRYPTO_PLATFORM):
        return "คริปโต"
    return "อื่นๆ"


def fee_to_add(amt_thb, qty, price, fx, comm) -> float:
    """ค่าธรรมเนียมที่ยังไม่ถูกรวมใน Total_Amout_THB — ชีตไม่สม่ำเสมอ ต้องดูรายแถว"""
    c = abs(comm or 0)
    if c <= 0:
        return 0.0
    base = abs(qty or 0) * abs(price or 0) * abs(fx or 1)
    if base <= 0:
        return c
    gap = abs(amt_thb or 0) - base
    already = abs(gap - c) <= max(0.02, c * 0.05)
    return 0.0 if already else c


def _f(v) -> float:
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0.0


def fetch_asset_tracker() -> list | None:
    """อ่าน Asset_Tracker ด้วย service account — คืน None ถ้าไม่ได้ตั้งค่าไว้"""
    rows, _ = fetch_asset_tracker_dx()
    return rows


# ══════════════════════════════════════════════════════════════════════
# เวอร์ชันที่บอก "ทำไม" ไม่ใช่แค่ "ไม่ได้"
# ══════════════════════════════════════════════════════════════════════
# เดิมทุกความล้มเหลว — ไม่ได้ตั้ง secret, JSON เสีย, ยังไม่แชร์ชีต, พิมพ์
# sheet id ผิด, ไม่มีแท็บ Asset_Tracker — ออกมาเป็นข้อความเดียวกันหมดคือ
# "ยังไม่ได้ต่อชีต" แล้วผู้ใช้ต้องไล่เดาเองทีละข้อ ซึ่งเสียเวลามาก
# ตอนนี้แต่ละสาเหตุมีข้อความของตัวเอง พร้อมบอกว่าต้องไปแก้ที่ไหน
SHEET_TAB = os.environ.get("GS_SHEET_TAB", "Asset_Tracker")
SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
TOKEN_URI = "https://oauth2.googleapis.com/token"


# ══════════════════════════════════════════════════════════════════════
# ขอ access token เอง — ไม่ผ่าน transport ของ google-auth
# ══════════════════════════════════════════════════════════════════════
# เดิมใช้ google.auth.transport.requests.Request ซึ่งบังคับให้ต้องมี `requests`
# ติดตั้งเพิ่มอีกตัว ทั้งที่ `pip install google-auth` ไม่ได้ลงมาให้
# อาการคือ import google.auth ผ่าน แต่ล้มตอนสร้าง Request
# ("The requests library is not installed")
#
# การเติม requests เข้าไปแก้ได้เฉพาะหน้า แต่ผูกเราไว้กับ dependency chain
# ของ google-auth ที่เปลี่ยนได้อีก จึงตัดออกทั้งชั้น:
#   เซ็น JWT ด้วย google.auth.crypt (มาพร้อม google-auth เสมอ)
#   แล้วแลก token ด้วย urllib ที่อยู่ใน stdlib
# ตอนนี้พึ่ง google-auth แค่ส่วนเซ็นลายเซ็น ที่เหลือเป็น stdlib ล้วน
def _build_jwt_assertion(info: dict, scope: str) -> str:
    """สร้าง signed JWT ตามสเปก OAuth 2.0 service account flow"""
    from google.auth import crypt, jwt                     # type: ignore
    now = int(time.time())
    payload = {
        "iss":   info["client_email"],
        "scope": scope,
        "aud":   info.get("token_uri") or TOKEN_URI,
        "iat":   now,
        "exp":   now + 3600,
    }
    signer = crypt.RSASigner.from_service_account_info(info)
    tok = jwt.encode(signer, payload)
    return tok.decode("ascii") if isinstance(tok, bytes) else tok


def _access_token(info: dict, scope: str) -> str:
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion":  _build_jwt_assertion(info, scope),
    }).encode()
    req = urllib.request.Request(
        info.get("token_uri") or TOKEN_URI, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["access_token"]


def fetch_asset_tracker_dx() -> tuple[list | None, str]:
    """คืน (rows, reason) — reason='ok' เมื่อสำเร็จ ไม่งั้นเป็นคำอธิบายภาษาไทย"""
    sheet_id = os.environ.get("GS_SHEET_ID", "").strip()
    sa_raw = os.environ.get("GOOGLE_SA_KEY", "").strip()

    missing = [n for n, v in (("GS_SHEET_ID", sheet_id),
                              ("GOOGLE_SA_KEY", sa_raw)) if not v]
    if missing:
        return None, f"ยังไม่ได้ตั้ง secret: {', '.join(missing)}"

    # sheet id ที่ยาวผิดปกติมักแปลว่าวาง URL ทั้งอันมา ไม่ใช่เฉพาะ id
    if "/" in sheet_id or "http" in sheet_id.lower():
        return None, ("GS_SHEET_ID เป็น URL ทั้งอัน — ต้องใส่เฉพาะส่วนระหว่าง "
                      "/d/ กับ /edit")

    try:
        from google.auth import crypt, jwt                 # noqa: F401
    except ImportError as e:
        # บอก interpreter ที่กำลังรันด้วย — อาการนี้มักไม่ใช่ "ลืมติดตั้ง"
        # แต่เป็น pip ติดตั้งลงคนละ Python กับตัวที่รันสคริปต์
        return None, (f"ไม่มีไลบรารี google-auth ใน {sys.executable} ({e}) — "
                      "workflow ต้องใช้ `python3 -m pip install google-auth` "
                      "ไม่ใช่ `pip install`")

    try:
        info = json.loads(sa_raw)
    except json.JSONDecodeError as e:
        return None, (f"GOOGLE_SA_KEY ไม่ใช่ JSON ที่ถูกต้อง ({e.msg}) — "
                      "ต้อง copy ทั้งไฟล์รวมปีกกา { }")
    if info.get("type") != "service_account":
        return None, "GOOGLE_SA_KEY ไม่ใช่คีย์แบบ service account (ใส่ไฟล์ผิดประเภท)"
    sa_email = info.get("client_email", "(ไม่รู้อีเมล)")

    for k in ("private_key", "client_email"):
        if not info.get(k):
            return None, f"GOOGLE_SA_KEY ไม่มีฟิลด์ '{k}' — ไฟล์คีย์ไม่สมบูรณ์"
    try:
        token = _access_token(info, SCOPE)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        if "invalid_grant" in detail:
            return None, ("Google ปฏิเสธคีย์ (invalid_grant) — คีย์ถูกลบ/ปิดใช้งาน "
                          "หรือนาฬิกาเครื่องเพี้ยน")
        return None, f"ขอ token ไม่สำเร็จ HTTP {e.code}: {detail}"
    except Exception as e:                                  # noqa: BLE001
        return None, f"ขอ token ไม่สำเร็จ ({type(e).__name__}: {e})"

    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
           f"/values/{urllib.parse.quote(SHEET_TAB)}!A1:Z10000")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read()).get("values", [])
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400]
        if e.code == 403 and "disabled" in body.lower():
            return None, "Sheets API ยังไม่ได้เปิดในโปรเจกต์นี้"
        if e.code == 403:
            return None, (f"ชีตยังไม่ได้แชร์ให้ {sa_email} "
                          "(Share → วางอีเมลนี้ → Viewer)")
        if e.code == 404:
            return None, "หา spreadsheet ไม่เจอ — GS_SHEET_ID น่าจะผิด"
        if e.code == 400 and "Unable to parse range" in body:
            return None, f"ไม่มีแท็บชื่อ '{SHEET_TAB}' ในชีตนี้"
        return None, f"Sheets API ตอบ HTTP {e.code}: {body[:120]}"
    except Exception as e:                                  # noqa: BLE001
        return None, f"เชื่อมต่อ Sheets ไม่ได้ ({type(e).__name__}: {e})"

    if not rows:
        return None, f"แท็บ '{SHEET_TAB}' ว่างเปล่า"
    if len(rows) < 2:
        return None, f"แท็บ '{SHEET_TAB}' มีแต่หัวตาราง ไม่มีข้อมูล"
    return rows, "ok"


def build_portfolio(rows: list, market: dict) -> dict | None:
    """คืน {total, cost, groups:{name:{value,cost}}, holdings:{ticker:{...}}}"""
    if not rows or len(rows) < 2:
        return None
    head = [str(h).strip() for h in rows[0]]

    def col(*names):
        for n in names:
            if n in head:
                return head.index(n)
        return -1

    C = {
        "date": col("Date"), "tx": col("Transaction_Type"), "ticker": col("Ticker"),
        "atype": col("Asset_Type"), "platform": col("Platform"),
        "fx": col("FX_Rate"), "qty": col("Quantity", "Quatity"), "price": col("Price"),
        "comm": col("Commission_THB", "Commission_Fee-Tax_THB"),
        "amt": col("Total_Amount_THB", "Total_Amout_THB"),
    }
    if C["ticker"] < 0 or C["tx"] < 0:
        print("⚠️  Asset_Tracker ไม่มีคอลัมน์ Ticker/Transaction_Type", file=sys.stderr)
        return None

    def cell(r, k):
        i = C[k]
        return r[i] if 0 <= i < len(r) else ""

    net_qty, wacc, groups_of, div_total = {}, {}, {}, 0.0
    for r in rows[1:]:
        ticker = str(cell(r, "ticker")).strip()
        if not ticker:
            continue
        tx = str(cell(r, "tx")).strip()
        fx = _f(cell(r, "fx")) or 1.0
        qty = abs(_f(cell(r, "qty")))
        amt = _f(cell(r, "amt"))
        comm = _f(cell(r, "comm"))
        price = _f(cell(r, "price"))
        groups_of[ticker] = resolve_group(cell(r, "atype"), ticker, cell(r, "platform"))
        if tx == "Dividend Payout":
            div_total += abs(amt)
        if tx in IS_COST and qty > 0:
            true_cost = abs(amt) + fee_to_add(amt, qty, price, fx, comm)
            a = wacc.setdefault(ticker, {"cost": 0.0, "qty": 0.0})
            a["cost"] += true_cost
            a["qty"] += qty
        s = SIGN.get(tx, 0)
        if s:
            net_qty[ticker] = net_qty.get(ticker, 0.0) + qty * s

    px = market.get("prices", {}) or {}
    usdthb = ((market.get("data", {}) or {}).get("USDTHB", {}) or {}).get("value") or 32.0

    holdings, groups = {}, {}
    total = cost_total = 0.0
    for tk, q in net_qty.items():
        if q <= 1e-9:
            continue
        p = px.get(tk)
        if not p:
            continue                       # ไม่มีราคา → ข้าม ดีกว่านับเป็น ฿0 เงียบๆ
        thb = float(p["price"]) * (usdthb if p.get("ccy") == "USD" else 1.0)
        val = q * thb
        w = wacc.get(tk, {})
        unit_cost = (w["cost"] / w["qty"]) if w.get("qty") else 0.0
        cst = q * unit_cost
        g = groups_of.get(tk, "อื่นๆ")
        holdings[tk] = {"qty": q, "price": float(p["price"]), "ccy": p.get("ccy", "THB"),
                        "value": val, "cost": cst, "group": g}
        gg = groups.setdefault(g, {"value": 0.0, "cost": 0.0})
        gg["value"] += val
        gg["cost"] += cst
        total += val
        cost_total += cst

    missing = [t for t, q in net_qty.items() if q > 1e-9 and t not in px]
    return {"total": total, "cost": cost_total, "groups": groups,
            "holdings": holdings, "dividends": div_total, "missing": missing}


# ══════════════════════════════════════════════════════════════════════
# 3. ข้อความ
# ══════════════════════════════════════════════════════════════════════
def daily_message(port, market, prev, reason="") -> str:
    L = [f"📊 สรุปพอร์ต {th_date(NOW)}", ""]

    if port:
        t, c = port["total"], port["cost"]
        L.append(f"มูลค่ารวม {money(t)}")
        pt = prev.get("total")
        if pt:
            d = t - pt
            L.append(f"เทียบรอบก่อน {signed(d)} ({pct(d / pt * 100)})")
        if c > 0:
            g = t - c
            L.append(f"กำไรสะสม {signed(g)} ({pct(g / c * 100)})")
        if port["dividends"]:
            L.append(f"ปันผลสะสม {money(port['dividends'])}")

        L.append("")
        L.append("แยกตามประเภท")
        pg = prev.get("groups", {})
        for name, g in sorted(port["groups"].items(), key=lambda kv: -kv[1]["value"]):
            line = f"  {name} {money(g['value'])}"
            old = pg.get(name, {}).get("value")
            if old:
                line += f"  {pct((g['value'] - old) / old * 100)}"
            L.append(line)

        if port["missing"]:
            L.append("")
            L.append(f"⚠️ ไม่มีราคา {len(port['missing'])} ตัว: "
                     + ", ".join(port["missing"][:6]))
    else:
        # บอกสาเหตุจริงในข้อความ ไม่ใช่ให้ไปเปิด log หา — ผู้ใช้เห็นปัญหา
        # บนมือถือทันทีว่าต้องไปแก้ที่ไหน
        L.append("⚠️ ยังอ่านพอร์ตไม่ได้")
        if reason:
            L.append(f"   {reason}")
        L.append("   (ส่วนภาวะตลาดด้านล่างยังใช้ได้ปกติ)")

    d = market.get("data", {}) or {}
    bits = []
    for k, label, unit in [("SET_INDEX", "SET", ""), ("SP500", "S&P", ""),
                           ("USDTHB", "USD/THB", ""), ("VIX", "VIX", "")]:
        v = (d.get(k) or {}).get("value")
        if v is not None:
            bits.append(f"{label} {v:,.2f}")
    if bits:
        L += ["", "ตลาด: " + " · " .join(bits)]

    gen = market.get("generated_at", "")[:16].replace("T", " ")
    L += ["", f"ข้อมูล {gen} UTC"]
    return "\n".join(L)


def movers(port, prev, th_stock=5.0, th_crypto=8.0):
    """ตัวที่ราคาขยับเกินเกณฑ์เทียบรอบก่อน — คริปโตใช้เกณฑ์สูงกว่าเพราะผันผวนเป็นปกติ"""
    out = []
    pp = prev.get("prices", {})
    for tk, h in (port or {}).get("holdings", {}).items():
        old = pp.get(tk)
        if not old:
            continue
        chg = (h["price"] / old - 1) * 100 if old else 0.0
        lim = th_crypto if h["group"] == "คริปโต" else th_stock
        if abs(chg) >= lim:
            out.append((tk, chg, h["value"]))
    out.sort(key=lambda x: -abs(x[1]))
    return out


def alert_message(mv, port) -> str:
    L = ["⚡ ราคาขยับแรง", ""]
    for tk, chg, val in mv[:8]:
        arrow = "▲" if chg > 0 else "▼"
        L.append(f"  {arrow} {tk}  {pct(chg)}   {money(val)}")
    if port:
        L += ["", f"มูลค่าพอร์ตตอนนี้ {money(port['total'])}"]
    L += ["", f"{NOW:%d/%m %H:%M}"]
    return "\n".join(L)


def period_message(port, market, base, label) -> str:
    L = [f"🗓 สรุป{label} — {th_date(NOW)}", ""]
    if not port:
        return ""
    t = port["total"]
    L.append(f"มูลค่ารวม {money(t)}")
    bt = (base or {}).get("total")
    if bt:
        d = t - bt
        L.append(f"เปลี่ยนแปลง{label} {signed(d)} ({pct(d / bt * 100)})")
    if port["cost"] > 0:
        g = t - port["cost"]
        L.append(f"กำไรสะสม {signed(g)} ({pct(g / port['cost'] * 100)})")

    bp = (base or {}).get("prices", {})
    ch = []
    for tk, h in port["holdings"].items():
        o = bp.get(tk)
        if o:
            ch.append((tk, (h["price"] / o - 1) * 100))
    if ch:
        ch.sort(key=lambda x: -x[1])
        # แยกด้วย "เครื่องหมาย" ไม่ใช่ตำแหน่งในลิสต์ — ถ้าถือแค่ 4 ตัว
        # หัว 3 กับท้าย 3 จะทับกัน แล้วตัวเดียวกันโผล่ทั้งดีสุดและแย่สุด
        # พร้อมลูกศรลงบนตัวเลขบวก ซึ่งอ่านแล้วเข้าใจผิดทันที
        up = [x for x in ch if x[1] > 0][:3]
        dn = [x for x in ch if x[1] < 0][-3:][::-1]
        if up:
            L += ["", "ดีสุด"] + [f"  ▲ {tk} {pct(c)}" for tk, c in up]
        if dn:
            L += ["", "แย่สุด"] + [f"  ▼ {tk} {pct(c)}" for tk, c in dn]

    L += ["", "แยกตามประเภท"]
    bg = (base or {}).get("groups", {})
    for name, g in sorted(port["groups"].items(), key=lambda kv: -kv[1]["value"]):
        line = f"  {name} {money(g['value'])}"
        old = bg.get(name, {}).get("value")
        if old:
            line += f"  {pct((g['value'] - old) / old * 100)}"
        L.append(line)
    return "\n".join(L)


# ══════════════════════════════════════════════════════════════════════
# 4. ส่ง
# ══════════════════════════════════════════════════════════════════════
def broadcast(text: str, dry: bool = False) -> bool:
    text = text.strip()
    if not text:
        print("— ไม่มีอะไรจะส่ง", file=sys.stderr)
        return False
    if len(text) > 4900:
        text = text[:4890] + "\n…"
    if dry:
        print("─── DRY RUN ───")
        print(text)
        print(f"─── {len(text)} ตัวอักษร ───")
        return True
    token = os.environ.get("LINE_CHANNEL_TOKEN", "").strip()
    if not token:
        print("::error::ไม่มี LINE_CHANNEL_TOKEN", file=sys.stderr)
        return False
    body = json.dumps({"messages": [{"type": "text", "text": text}]}).encode()
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/broadcast", data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"✓ ส่ง LINE แล้ว ({r.status}) · {len(text)} ตัวอักษร")
            return True
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        # 429 = เกินโควตาเดือนนี้ — ไม่ใช่ความผิดพลาดของโค้ด อย่าทำให้ job แดง
        lvl = "warning" if e.code == 429 else "error"
        print(f"::{lvl}::LINE HTTP {e.code}: {detail}", file=sys.stderr)
        return False
    except Exception as e:                                  # noqa: BLE001
        print(f"::error::LINE {type(e).__name__}: {e}", file=sys.stderr)
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="daily",
                    choices=["daily", "alert", "weekly", "monthly", "check"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stock-threshold", type=float, default=5.0)
    ap.add_argument("--crypto-threshold", type=float, default=8.0)
    a = ap.parse_args()

    market = load_market()
    state = load_state()
    rows, reason = fetch_asset_tracker_dx()
    port = build_portfolio(rows, market) if rows else None

    if reason != "ok":
        print(f"⚠️  อ่าน {SHEET_TAB} ไม่ได้: {reason}", file=sys.stderr)

    # ── โหมดตรวจสอบ: ไม่ส่ง LINE ไม่แตะ state แค่บอกว่าต่อชีตได้ไหม ──
    if a.mode == "check":
        print("═══ ตรวจการเชื่อมต่อ Google Sheet ═══")
        for k in ("GS_SHEET_ID", "GOOGLE_SA_KEY", "LINE_CHANNEL_TOKEN"):
            v = os.environ.get(k, "")
            print(f"  {k:<20} {'ตั้งแล้ว (' + str(len(v)) + ' ตัวอักษร)' if v else '❌ ยังไม่ได้ตั้ง'}")
        print(f"  แท็บที่จะอ่าน       {SHEET_TAB}")
        if reason != "ok":
            print(f"\n❌ {reason}")
            # ::error:: ทำให้เหตุผลขึ้นในกล่อง Annotations ของหน้า Summary
            # ไม่ใช่ซ่อนอยู่ใน log ที่ต้องกดเข้าไปกาง — เดิมผู้ใช้เห็นแค่
            # "Process completed with exit code 1" ซึ่งไม่บอกอะไรเลย
            print(f"::error title=ต่อ Google Sheet ไม่ได้::{reason}")
            return 1
        print(f"\n✓ อ่านได้ {len(rows)} แถว · หัวตาราง: {', '.join(str(h) for h in rows[0][:8])}")
        if not port:
            msg = "อ่านชีตได้ แต่คำนวณพอร์ตไม่ได้ — ตรวจชื่อคอลัมน์ Ticker/Transaction_Type"
            print(f"❌ {msg}")
            print(f"::error title=คำนวณพอร์ตไม่ได้::{msg}")
            return 1
        print(f"::notice title=ต่อชีตสำเร็จ::พอร์ต {port['total']:,.0f} บาท · "
              f"{len(port['holdings'])} ตัว")
        print(f"✓ พอร์ต {port['total']:,.2f} บาท · ต้นทุน {port['cost']:,.2f} "
              f"· {len(port['holdings'])} ตัวที่มีราคา")
        for tk, h in sorted(port["holdings"].items(),
                            key=lambda kv: -kv[1]["value"])[:10]:
            print(f"    {tk:<10} {h['value']:>14,.2f}  [{h['group']}]")
        if port["missing"]:
            print(f"  ไม่มีราคา: {', '.join(port['missing'])}")
        return 0

    if a.mode == "alert":
        mv = movers(port, state.get("last", {}), a.stock_threshold, a.crypto_threshold)
        sent = broadcast(alert_message(mv, port), a.dry_run) if mv else False
        if not mv:
            print("— ไม่มีตัวไหนขยับเกินเกณฑ์")
    elif a.mode in ("weekly", "monthly"):
        label = "รายสัปดาห์" if a.mode == "weekly" else "รายเดือน"
        base = state.get("week" if a.mode == "weekly" else "month", {})
        sent = broadcast(period_message(port, market, base, label), a.dry_run)
    else:
        sent = broadcast(
            daily_message(port, market, state.get("last", {}),
                          "" if reason == "ok" else reason), a.dry_run)

    # ── อัปเดต state ─────────────────────────────────────────────────
    # เก็บหลังส่งเสมอ แม้ส่งไม่สำเร็จ ไม่งั้นรอบหน้าจะเทียบกับฐานเก่าเกินจริง
    if port and not a.dry_run:
        snap = {
            "at": NOW.isoformat(),
            "total": port["total"],
            "groups": {k: {"value": v["value"]} for k, v in port["groups"].items()},
            "prices": {k: v["price"] for k, v in port["holdings"].items()},
        }
        state["last"] = snap
        if a.mode == "weekly" or "week" not in state:
            state["week"] = snap
        if a.mode == "monthly" or "month" not in state:
            state["month"] = snap
        save_state(state)

    return 0 if sent or a.mode == "alert" else 0     # ไม่เคยทำให้ workflow แดง


if __name__ == "__main__":
    sys.exit(main())
