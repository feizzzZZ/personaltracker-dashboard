#!/usr/bin/env python3
"""
#29 — สร้างไฟล์ icon ทั้ง 7 ขนาดที่ manifest.json / HTML / service-worker อ้างถึง
      แต่ไม่เคยมีอยู่จริง (favicon 404, installability check ล้ม, A2HS ไม่สมบูรณ์)

ออกแบบด้วยรูปทรงล้วน ไม่ใช้ฟอนต์/ภาพภายนอก → ผลลัพธ์เหมือนกันทุกเครื่อง
รูป: กราฟแท่งไต่ระดับ + เส้นแนวโน้มขาขึ้น บนพื้นหลังสีเดียวกับ theme_color

maskable: manifest ระบุ purpose "maskable any" สำหรับ 192/512 ระบบจะครอปเป็นวงกลม
ได้ถึง ~20% ของแต่ละด้าน จึงวางเนื้อหาทั้งหมดไว้ในกรอบกลาง 60% (safe zone)
และเว้นพื้นหลังทึบเต็มภาพ ไม่ให้มีมุมโปร่งใสที่จะกลายเป็นขอบดำ
"""
from PIL import Image, ImageDraw

BG   = (9, 9, 15)        # #09090f — ตรงกับ theme_color/background_color ใน manifest
GAIN = (0, 212, 160)     # #00d4a0
BLUE = (76, 201, 240)    # #4cc9f0
GOLD = (255, 209, 102)   # #ffd166

SIZES = [48, 72, 96, 144, 180, 192, 512]
SS = 4                   # supersample ×4 แล้วย่อ → ขอบเรียบโดยไม่ต้องพึ่ง AA ของ PIL


def make(size: int) -> Image.Image:
    S = size * SS
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)

    # safe zone: เนื้อหาอยู่กลางภาพ 60% (maskable ครอปได้ถึง 20% ต่อด้าน)
    pad = S * 0.20
    inner = S - pad * 2

    # แท่งกราฟ 4 แท่ง ไต่ระดับ — สื่อถึงสินทรัพย์ที่โตขึ้นตามเวลา
    n = 4
    gap = inner * 0.07
    bw = (inner - gap * (n - 1)) / n
    heights = [0.34, 0.52, 0.72, 1.00]          # สัดส่วนความสูงเทียบ inner
    colors = [BLUE, BLUE, GAIN, GAIN]
    radius = max(1, int(bw * 0.22))
    base_y = pad + inner

    for i in range(n):
        x0 = pad + i * (bw + gap)
        h = inner * heights[i] * 0.82
        d.rounded_rectangle([x0, base_y - h, x0 + bw, base_y],
                            radius=radius, fill=colors[i])

    # เส้นแนวโน้มขาขึ้นพาดผ่านยอดแท่ง + จุดหมายปลายทางสีทอง
    pts = []
    for i in range(n):
        x = pad + i * (bw + gap) + bw / 2
        y = base_y - inner * heights[i] * 0.82
        pts.append((x, y))
    d.line(pts, fill=GOLD, width=max(2, int(S * 0.022)), joint="curve")

    r = S * 0.030
    ex, ey = pts[-1]
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=GOLD)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    for s in SIZES:
        make(s).save(f"icon-{s}x{s}.png", "PNG", optimize=True)
        print(f"  ✓ icon-{s}x{s}.png")
