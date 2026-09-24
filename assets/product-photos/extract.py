from PIL import Image, ImageFilter
from scipy import ndimage
import numpy as np, os

SRC = "assets/product-photos"
OUT = "/tmp/claude-0/-home-user-shop/dc11b519-6731-5468-abca-c317acd34951/scratchpad/bottles"
FILES = {
    "milk-180":   "a2-jersey-hay-milk-180ml.png",
    "milk-750":   "a2-jersey-hay-milk-750ml.png",
    "yogurt-180": "a2-jersey-plain-yogurt-180ml.png",
    "yogurt-500": "a2-jersey-plain-yogurt-500ml.png",
}

def cutout(path, strong=95):
    """촬영본에서 병 몸통만 따낸다.
       배경은 균일한 크림색이지만 병 좌우에 부드러운 그림자가 깔려 있다. 밝기 임계만 쓰면
       그 그림자 조각이 병에 붙어 폭이 부풀고 라벨 옆에 지느러미가 생긴다.
       임계 → 세로 채우기 → 가장 큰 연결 덩어리만 남기기 순으로 몸통 실루엣을 얻는다."""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    H, W, _ = a.shape
    bg = np.median(np.concatenate([a[:8, :].reshape(-1, 3), a[-8:, :].reshape(-1, 3)]), 0)
    m = np.abs(a - bg).sum(2) > strong

    # 병 내부(배경색과 비슷한 크림 부분)를 세로로 메운다. 가로로는 메우지 않는다 —
    # 목 옆 잡티 사이가 이어져 어깨에 없는 턱이 생긴다.
    fill = np.zeros_like(m)
    for x in range(W):
        c = np.where(m[:, x])[0]
        if len(c) and (c.max() - c.min()) > H * 0.02:
            fill[c.min():c.max() + 1, x] = True

    lab, n = ndimage.label(fill)
    if n > 1:
        sizes = ndimage.sum(fill, lab, range(1, n + 1))
        fill = lab == (int(np.argmax(sizes)) + 1)
    fill = ndimage.binary_fill_holes(fill)

    am = Image.fromarray((fill * 255).astype(np.uint8), "L")
    am = am.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(0.9))
    rgba = im.convert("RGBA"); rgba.putalpha(am)
    return rgba.crop(rgba.getbbox())

os.makedirs(OUT, exist_ok=True)
for pid, fn in FILES.items():
    cut = cutout(os.path.join(SRC, fn))
    cut.save(f"{OUT}/{pid}.png")
    print(f"{pid:12s} {cut.size}  h/w={cut.size[1]/cut.size[0]:.2f}")
