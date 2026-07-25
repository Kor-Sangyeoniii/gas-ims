#!/usr/bin/env python3
"""PSG-포항충전소 GAS-IMS 아이콘 / 기동화면 생성기.

index.html 헤더에 박혀 있던 PSG 로고(이중 셰브론)를 벡터로 재구성해서
아이폰 홈 화면 아이콘과 기동 화면(splash)을 만든다.
"""
import os
from PIL import Image, ImageDraw

REPO = "/home/user/gas-ims"
OUT = os.path.join(REPO, "icons")

BG     = (13, 17, 23)     # --bg  #0d1117
MAROON = (144, 0, 41)     # 원본 로고 왼쪽 셰브론
TEAL   = (0, 117, 112)    # 원본 로고 오른쪽 셰브론
ACCENT = (57, 211, 83)    # --accent #39d353

SS = 4  # 슈퍼샘플링 배율 (안티에일리어싱용)


def draw_mark(size, scale=1.0, with_bar=True):
    """PSG 이중 셰브론 마크가 들어간 정사각 아이콘 한 장.

    scale: 마크가 캔버스에서 차지하는 비율. maskable 아이콘은 안전영역
           (중앙 80%) 안에 들어가야 하므로 더 작게 그린다.
    """
    S = size * SS
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)

    mw = S * 0.78 * scale      # 마크 전체 너비
    mh = mw * 0.46             # 전체 높이 (원본 로고 비율)
    cx = S / 2
    left = cx - mw / 2
    top = S / 2 - mh / 2

    w = mw * 0.34              # 셰브론 하나의 밑변 반폭
    h = mh                     # 높이
    t = mh * 0.44              # 두께

    apexes = (left + w, left + mw - w)

    # 왼쪽(마룬) → 오른쪽(틸) 순서로 그려 틸이 위에 겹치도록
    for ax, color in zip(apexes, (MAROON, TEAL)):
        d.polygon([(ax - w, top + h), (ax, top), (ax + w, top + h)], fill=color)

    # 속을 배경색으로 파내 'Λ' 셰브론 형태로 만든다
    for ax in apexes:
        k = t * w / h
        d.polygon([(ax - w + k, top + h + 2), (ax, top + t * 1.25),
                   (ax + w - k, top + h + 2)], fill=BG)

    if with_bar:
        # 하단 액센트 바 — 앱 테마(초록)와 시각적으로 연결
        bw, bh = mw * 0.30, S * 0.022
        by = top + h + S * 0.085 * scale
        d.rounded_rectangle([cx - bw / 2, by, cx + bw / 2, by + bh],
                            radius=bh / 2, fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


def splash(w, h):
    img = Image.new("RGB", (w, h), BG)
    icon_px = int(min(w, h) * 0.32)
    icon = draw_mark(icon_px)
    img.paste(icon, ((w - icon_px) // 2, (h - icon_px) // 2 - int(h * 0.04)))
    return img


def save(img, name):
    p = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, optimize=True)
    print(f"  {name:36s} {img.size[0]:>4}x{img.size[1]:<4}  {os.path.getsize(p):>8,}B")


# (가로px, 세로px, CSS너비, CSS높이, dpr, 기종)
DEVICES = [
    (750,  1334, 375, 667, 2, "iPhone SE / 8"),
    (1242, 2208, 414, 736, 3, "iPhone 8 Plus"),
    (1125, 2436, 375, 812, 3, "iPhone X / XS / 11 Pro / 12·13 mini"),
    (828,  1792, 414, 896, 2, "iPhone XR / 11"),
    (1242, 2688, 414, 896, 3, "iPhone XS Max / 11 Pro Max"),
    (1170, 2532, 390, 844, 3, "iPhone 12 / 13 / 14"),
    (1284, 2778, 428, 926, 3, "iPhone 12·13 Pro Max / 14 Plus"),
    (1179, 2556, 393, 852, 3, "iPhone 14 Pro / 15 / 15 Pro / 16"),
    (1290, 2796, 430, 932, 3, "iPhone 14 Pro Max / 15 Plus / 16 Plus"),
    (1206, 2622, 402, 874, 3, "iPhone 16 Pro"),
    (1320, 2868, 440, 956, 3, "iPhone 16 Pro Max"),
]

if __name__ == "__main__":
    print("아이콘:")
    save(draw_mark(180), "apple-touch-icon.png")
    save(draw_mark(192), "icon-192.png")
    save(draw_mark(512), "icon-512.png")
    save(draw_mark(192, scale=0.72), "icon-maskable-192.png")
    save(draw_mark(512, scale=0.72), "icon-maskable-512.png")
    save(draw_mark(32, with_bar=False), "favicon-32.png")

    print("\n기동 화면:")
    tags = []
    for w, h, cw, ch, dpr, _label in DEVICES:
        for orient, (ow, oh) in (("portrait", (w, h)), ("landscape", (h, w))):
            name = f"splash/{cw}x{ch}@{dpr}x-{orient}.png"
            save(splash(ow, oh), name)
            tags.append(
                f'<link rel="apple-touch-startup-image" href="icons/{name}"\n'
                f'      media="(device-width:{cw}px) and (device-height:{ch}px) '
                f'and (-webkit-device-pixel-ratio:{dpr}) and (orientation:{orient})">'
            )
    # index.html <head>에 붙여넣을 <link rel="apple-touch-startup-image"> 태그
    out = os.path.join(REPO, "tools", "splash-tags.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(tags) + "\n")
    print(f"\n<link> 태그 {len(tags)}개 → {out}")
    print("기종을 추가했다면 이 파일 내용을 index.html <head>의 기동 화면 블록에 반영하세요.")
