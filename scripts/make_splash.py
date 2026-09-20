#!/usr/bin/env python3
"""
สร้าง splash screen ของ iOS (apple-touch-startup-image) + แท็ก <link> ที่ต้องใส่

ทำไมต้องมี: iOS ไม่ใช้ background_color จาก manifest.json เลย ถ้าไม่มี
startup image ที่ "ตรงรุ่นเครื่องเป๊ะ ๆ" จะโชว์จอขาววาบทุกครั้งที่เปิดแอป
ซึ่งดูเหมือนแอปค้างมากกว่าแอปกำลังโหลด

กติกาของ Apple ที่ทำให้เรื่องนี้ยุ่ง:
  - จับคู่ด้วย media query ที่ต้องตรงทั้ง device-width, device-height และ DPR
  - ไม่ตรงแม้แต่พิกเซลเดียว = ไม่ใช้เลย (ไม่มี fallback แบบย่อ/ขยายให้)
  - จึงต้องมีไฟล์แยกต่อรุ่น ไม่ใช่ไฟล์เดียวใช้ได้หมด

รูปใช้ภาษาเดียวกับ make_icons.py — กราฟแท่งไต่ระดับ + เส้นแนวโน้ม
ไม่ใช้ฟอนต์หรือภาพภายนอก ผลลัพธ์จึงเหมือนกันทุกเครื่องที่รัน

  python3 scripts/make_splash.py           # เขียน splash/*.png + พิมพ์แท็ก
  python3 scripts/make_splash.py --tags    # พิมพ์แท็กอย่างเดียว ไม่สร้างไฟล์
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "splash"

BG = (9, 9, 15)          # #09090f — ตรงกับ theme_color/background_color ใน manifest
GAIN = (0, 212, 160)     # #00d4a0
BLUE = (76, 201, 240)    # #4cc9f0
GOLD = (255, 209, 102)   # #ffd166

# (ชื่อไฟล์, device-width, device-height, dpr)
# เรียงจากรุ่นใหม่ไปเก่า — ครอบคลุม iPhone ที่ยังได้ iOS 16.4+ (ขั้นต่ำของ PWA บน iOS)
# ขนาดพิกเซลจริง = device-width × dpr, device-height × dpr
DEVICES = [
    # ── iPhone ──
    ("iphone-16-pro-max",   440, 956, 3),
    ("iphone-16-pro",       402, 874, 3),
    ("iphone-15-pro-max",   430, 932, 3),   # 14 Pro Max / 15 Plus / 16 Plus ด้วย
    ("iphone-15-pro",       393, 852, 3),   # 14 Pro / 15 / 16 ด้วย
    ("iphone-13-pro-max",   428, 926, 3),   # 12 Pro Max / 14 Plus ด้วย
    ("iphone-13",           390, 844, 3),   # 12 / 12 Pro / 13 Pro / 14 ด้วย
    ("iphone-11-pro-max",   414, 896, 3),   # XS Max ด้วย
    ("iphone-11",           414, 896, 2),   # XR ด้วย
    ("iphone-x",            375, 812, 3),   # XS / 11 Pro / 12 mini / 13 mini ด้วย
    ("iphone-8-plus",       414, 736, 3),
    ("iphone-se",           375, 667, 2),   # 8 / SE2 / SE3 ด้วย
    # ── iPad ──
    ("ipad-pro-13",        1024, 1366, 2),  # 12.9" ด้วย
    ("ipad-pro-11",         834, 1194, 2),
    ("ipad-air-11",         820, 1180, 2),
    ("ipad-10",             810, 1080, 2),
]

SS = 2                   # supersample แล้วย่อ — ขอบเรียบโดยไม่พึ่ง AA ของ PIL


def draw_mark(d: ImageDraw.ImageDraw, cx: float, cy: float, size: float) -> None:
    """วาดโลโก้กราฟแท่ง + เส้นแนวโน้ม ให้กึ่งกลางอยู่ที่ (cx, cy) กว้าง size

    สัดส่วนทุกตัวยกมาจาก make_icons.py เพื่อให้ splash กับ icon เป็นรูปเดียวกัน
    ถ้าแก้ที่นั่นต้องแก้ที่นี่ด้วย ไม่งั้นสองที่จะเพี้ยนจากกันอย่างเงียบ ๆ
    """
    inner = size
    left = cx - inner / 2
    base_y = cy + inner / 2

    n = 4
    gap = inner * 0.07
    bw = (inner - gap * (n - 1)) / n
    heights = [0.34, 0.52, 0.72, 1.00]
    colors = [BLUE, BLUE, GAIN, GAIN]
    radius = max(1, int(bw * 0.22))

    for i in range(n):
        x0 = left + i * (bw + gap)
        h = inner * heights[i] * 0.82
        d.rounded_rectangle([x0, base_y - h, x0 + bw, base_y],
                            radius=radius, fill=colors[i])

    pts = []
    for i in range(n):
        x = left + i * (bw + gap) + bw / 2
        y = base_y - inner * heights[i] * 0.82
        pts.append((x, y))
    d.line(pts, fill=GOLD, width=max(2, int(inner * 0.022)), joint="curve")

    r = inner * 0.030
    ex, ey = pts[-1]
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=GOLD)


def make(w_px: int, h_px: int) -> Image.Image:
    W, H = w_px * SS, h_px * SS
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # โลโก้กว้าง 34% ของด้านสั้น — ใหญ่พอให้เห็นชัด แต่ไม่กินพื้นที่จนอึดอัด
    mark = min(W, H) * 0.34
    # วางเหนือกึ่งกลางเล็กน้อย (46% ของความสูง) — จุดที่สายตาไปพักตามธรรมชาติ
    # ถ้าวางกลางเป๊ะจะดูต่ำกว่าที่ควรเมื่อมองจริง
    draw_mark(d, W / 2, H * 0.46, mark)

    return img.resize((w_px, h_px), Image.LANCZOS)


# แต่ละรุ่นให้ 2 ไฟล์ — แนวตั้งกับแนวนอน
#
# สำคัญ: device-width/device-height ใน media query **ไม่สลับ** ตามการหมุนจอ
# มันเป็นค่าคงที่ของเครื่อง (width = ด้านสั้นเสมอ) สิ่งที่เปลี่ยนคือ `orientation`
# อย่างเดียว ส่วน "ภาพ" ต้องสลับ w/h — เป็นจุดที่พลาดกันบ่อยเพราะดูขัดความรู้สึก
def variants():
    """yield (ชื่อไฟล์, กว้างพิกเซล, สูงพิกเซล, media query)"""
    for name, w, h, dpr in DEVICES:
        base = (f"(device-width: {w}px) and (device-height: {h}px) "
                f"and (-webkit-device-pixel-ratio: {dpr})")
        yield f"{name}.png",      w * dpr, h * dpr, f"{base} and (orientation: portrait)"
        yield f"{name}-land.png", h * dpr, w * dpr, f"{base} and (orientation: landscape)"


def tags() -> str:
    out = ["<!-- iOS splash screens — สร้างด้วย scripts/make_splash.py",
           "     media query ต้องตรงทั้ง 3 ค่า ไม่งั้น iOS ไม่ใช้ไฟล์นั้นเลย",
           "     device-width/height ไม่สลับตามการหมุนจอ — สลับแค่ขนาดภาพ",
           "     (เพิ่มรุ่นใหม่: เติมใน DEVICES แล้วรันสคริปต์ใหม่ อย่าแก้มือที่นี่) -->"]
    for fname, _w, _h, media in variants():
        out.append(f'<link rel="apple-touch-startup-image" href="splash/{fname}"\n'
                   f'      media="{media}">')
    return "\n".join(out)


if __name__ == "__main__":
    if "--tags" in sys.argv:
        print(tags())
        sys.exit(0)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # ลบไฟล์เก่าที่ไม่อยู่ในชุดปัจจุบัน — กันไฟล์กำพร้าค้าง repo หลังแก้ DEVICES
    wanted = {f for f, _, _, _ in variants()}
    for old in OUT_DIR.glob("*.png"):
        if old.name not in wanted:
            old.unlink()
            print(f"  – ลบไฟล์เก่า splash/{old.name}")

    total = n = 0
    for fname, px_w, px_h, _media in variants():
        path = OUT_DIR / fname
        make(px_w, px_h).save(path, "PNG", optimize=True)
        kb = path.stat().st_size / 1024
        total += kb
        n += 1
        print(f"  ✓ splash/{fname}  {px_w}×{px_h}  {kb:.0f} KB")
    print(f"\nรวม {n} ไฟล์ · {total:.0f} KB")
    print("\nแท็กที่ต้องใส่ใน <head> ของ index.html:\n")
    print(tags())
