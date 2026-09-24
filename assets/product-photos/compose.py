from PIL import Image, ImageFilter
import numpy as np, os

CUT = "/tmp/claude-0/-home-user-shop/dc11b519-6731-5468-abca-c317acd34951/scratchpad/bottles"

# 실물 라인업 촬영본에서 잰 병 높이 비율(750mL = 1.000).
#   개별 촬영본은 저마다 프레임에 맞춰 크롭돼 용량 차이가 사라져 있었다(750 이 2.00배로
#   과장, 실제는 1.76배). 화면에서 보는 크기가 실제 병 크기와 같아야 한다.
SCALE = {"milk-750": 1.000, "yogurt-500": 0.7345, "yogurt-180": 0.5690, "milk-180": 0.5679}

# 폭 보정 — 개별 촬영본의 원근 왜곡을 되돌린다.
#   라인업 촬영본은 네 병이 한 프레임·한 렌즈·한 거리라 병끼리의 비율이 실물 그대로다.
#   그 라벨 폭 대비 개별 촬영본을 재보니 750mL 는 17% 통통하고(근접 촬영) 500mL 는 7%
#   날씬했다. 손님이 실물을 받았을 때 사진과 같아야 하므로 라인업 쪽에 맞춘다.
WIDTH_FIX = {"milk-180": 0.989, "milk-750": 0.854, "yogurt-500": 1.070, "yogurt-180": 1.013}

def scaled(pid, h750):
    im = Image.open(f"{CUT}/{pid}.png").convert("RGBA")
    h = round(h750 * SCALE[pid])
    w = round(im.size[0] * h / im.size[1] * WIDTH_FIX[pid])
    return im.resize((w, h), Image.LANCZOS)

def reflection(bottle, frac=0.22, opacity=92):
    """바닥 반사 — 원본 라인업 촬영본의 거울 바닥을 살린다."""
    w, h = bottle.size
    rh = int(h * frac)
    ref = bottle.transpose(Image.FLIP_TOP_BOTTOM).crop((0, 0, w, rh))
    alpha = np.asarray(ref.split()[3]).astype(float)
    fade = (np.linspace(1.0, 0.0, rh) ** 1.7)[:, None] * (opacity / 255)
    ref.putalpha(Image.fromarray((alpha * fade).astype(np.uint8), "L"))
    return ref.filter(ImageFilter.GaussianBlur(1.1))

def place(canvas, bottle, cx, baseline, frac=0.22):
    w, h = bottle.size
    x = int(cx - w / 2)
    canvas.alpha_composite(reflection(bottle, frac), (x, baseline))
    canvas.alpha_composite(bottle, (x, baseline - h))

# ── A. 개별 제품 사진 ─────────────────────────────────────────────────────
#   네 장이 같은 척도·같은 바닥선을 공유한다. 쇼케이스에서 나란히 놓였을 때
#   180mL 옆의 750mL 가 실제만큼 커 보이게 하려면 캔버스 척도가 같아야 한다.
S, H750, BASE = 1000, 872, 890
for pid in SCALE:
    b = scaled(pid, H750)
    c = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    place(c, b, S / 2, BASE, frac=0.12)
    p = f"public/products/{pid}-bottle.webp"
    c.save(p, "WEBP", quality=92, method=6)
    print(f"{pid:12s} 병 {b.size}  → {os.path.getsize(p)//1024}KB")

# ── B. 메인 히어로 라인업(1600×1195) — 실물 진열 순서 ─────────────────────
LW, LH, HL, BASEL = 1600, 1195, 840, 1000
row = Image.new("RGBA", (LW, LH), (255, 255, 255, 255))
order = ["milk-180", "milk-750", "yogurt-500", "yogurt-180"]
bots = {p: scaled(p, HL) for p in order}
gap = 52
x = (LW - (sum(b.size[0] for b in bots.values()) + gap * 3)) / 2
for p in order:
    place(row, bots[p], x + bots[p].size[0] / 2, BASEL)
    x += bots[p].size[0] + gap
row.convert("RGB").save("public/brand/hero-row-white.jpg", quality=90, optimize=True, progressive=True)
print(f"라인업 {row.size} → {os.path.getsize('public/brand/hero-row-white.jpg')//1024}KB")
