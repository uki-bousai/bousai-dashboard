#!/usr/bin/env python3
"""地図の画面写真に、大きな見出しを重ねる。
   Googleのピンは緯度経度しか出ないので、施設名がすぐ読めるようにする。"""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
ACC = (15, 122, 82)        # みどり
ACC_D = (8, 74, 50)
WHITE = (255, 255, 255)

def font(px):
    return ImageFont.truetype(FONT, px, index=0)

def label(d, xy, text, px=46, pad=(22, 26), bg=ACC, fg=WHITE, radius=14, outline=WHITE, ow=5):
    """角丸の見出しを置いて、その外形を返す"""
    f = font(px)
    x, y = xy
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    w = (r - l) + pad[0] * 2
    h = (b - t) + pad[1] * 2
    box = (x, y, x + w, y + h)
    d.rounded_rectangle(box, radius=radius, fill=bg, outline=outline, width=ow)
    d.text((x + pad[0] - l, y + pad[1] - t), text, font=f, fill=fg)
    return box

def marker(d, xy, r=34):
    """目的地の丸印"""
    x, y = xy
    d.ellipse((x - r - 7, y - r - 7, x + r + 7, y + r + 7), outline=WHITE, width=9)
    d.ellipse((x - r, y - r, x + r, y + r), fill=ACC, outline=WHITE, width=5)
    d.ellipse((x - 11, y - 11, x + 11, y + 11), fill=WHITE)

def north(d, xy, px=40):
    """北の向き"""
    x, y = xy
    f = font(px)
    d.rounded_rectangle((x, y, x + 84, y + 108), radius=14, fill=(255, 255, 255, 235),
                        outline=ACC_D, width=4)
    d.polygon([(x + 42, y + 16), (x + 26, y + 52), (x + 42, y + 44), (x + 58, y + 52)],
              fill=ACC_D)
    d.text((x + 42, y + 60), "北", font=f, fill=ACC_D, anchor="ma")

def build(src, dst, pin, name_xy, extra=(), north_xy=None, name_pad=(22, 26)):
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    marker(d, pin)
    label(d, name_xy, "北山崎公民館", px=52, pad=name_pad)
    for xy, txt, px in extra:
        label(d, xy, txt, px=px, pad=(18, 16), bg=(255, 255, 255), fg=(17, 17, 16), outline=ACC_D, ow=4)
    if north_xy:
        north(d, north_xy)
    im.save(dst)
    print(dst, im.size)

# 広域: 大きな道・セブン-イレブン・小熊野川まで入る
build("map-wide-raw.png", "map-wide.png",
      pin=(516, 470), name_xy=(556, 424),
      extra=[],
      north_xy=(14, 20))

# 近景: 建物のまわり
build("map-near-raw.png", "map-near.png",
      pin=(322, 812), name_xy=(370, 766),
      extra=[],
      north_xy=(846, 24), name_pad=(22, 32))
