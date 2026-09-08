#!/usr/bin/env python3
"""Generate Relic Line pixel-art sprite strips.

The pipeline mirrors the game-studio sprite workflow: each entity starts from a
stable seed pose, expands into one whole strip, keeps a shared frame size and
bottom-center anchor, and writes a preview sheet for quick inspection.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path
from typing import Callable, Iterable

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "sprites"


RGBA = tuple[int, int, int, int]
Painter = Callable[[ImageDraw.ImageDraw, int, int, int], None]


PALETTE: dict[str, RGBA] = {
    "ink": (36, 34, 35, 255),
    "ink_soft": (54, 48, 50, 255),
    "black": (18, 17, 18, 255),
    "white": (248, 244, 222, 255),
    "shadow": (35, 30, 34, 140),
    "shadow_deep": (10, 9, 11, 170),
    "cream": (235, 225, 194, 255),
    "gold": (216, 200, 119, 255),
    "gold_light": (245, 226, 128, 255),
    "copper": (211, 138, 76, 255),
    "copper_dark": (139, 80, 54, 255),
    "ember": (230, 94, 70, 255),
    "ember_hot": (255, 177, 84, 255),
    "ember_dark": (126, 47, 37, 255),
    "teal": (88, 190, 180, 255),
    "teal_light": (143, 236, 224, 255),
    "teal_dark": (38, 112, 116, 255),
    "blue": (91, 146, 216, 255),
    "blue_light": (150, 210, 245, 255),
    "blue_dark": (43, 78, 138, 255),
    "violet": (143, 119, 219, 255),
    "violet_light": (187, 165, 246, 255),
    "violet_dark": (78, 62, 132, 255),
    "green": (123, 181, 100, 255),
    "green_light": (171, 217, 112, 255),
    "green_dark": (54, 111, 66, 255),
    "moss": (77, 128, 84, 255),
    "moss_dark": (40, 75, 54, 255),
    "path": (94, 83, 69, 255),
    "path_light": (143, 116, 82, 255),
    "path_dark": (65, 54, 46, 255),
    "stone": (94, 96, 99, 255),
    "stone_light": (144, 146, 143, 255),
    "stone_dark": (53, 55, 59, 255),
    "dark": (26, 29, 31, 255),
    "oil": (58, 38, 22, 255),
    "oil_light": (121, 68, 36, 255),
    "ice": (184, 230, 240, 255),
    "ice_dark": (77, 148, 184, 255),
    "ash": (82, 78, 74, 255),
    "ash_light": (128, 121, 111, 255),
    "glass": (166, 237, 226, 255),
    "glass_dark": (64, 134, 140, 255),
    "smoke": (105, 99, 116, 255),
    "lava": (255, 124, 50, 255),
    "relic": (238, 198, 86, 255),
}


def clean() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    for relative in [
        "terrain",
        "towers",
        "enemies",
        "heroes",
        "machines",
        "tools",
        "powerups",
        "relics",
        "fx",
        "seed",
        "preview",
    ]:
        (OUT / relative).mkdir(parents=True, exist_ok=True)


def rgba(name: str) -> RGBA:
    return PALETTE[name]


def alpha(name: str, opacity: int) -> RGBA:
    r, g, b, _ = rgba(name)
    return (r, g, b, opacity)


def sheet(frame_size: int, frames: int, painter: Painter) -> Image.Image:
    image = Image.new("RGBA", (frame_size * frames, frame_size), (0, 0, 0, 0))
    for frame in range(frames):
        frame_image = Image.new("RGBA", (frame_size, frame_size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(frame_image)
        painter(draw, frame, frames, frame_size)
        image.alpha_composite(frame_image, (frame * frame_size, 0))
    return image


def save_strip(path: Path, frame_size: int, frames: int, painter: Painter, seed_name: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    strip = sheet(frame_size, frames, painter)
    strip.save(path)
    seed = strip.crop((0, 0, frame_size, frame_size))
    seed.save(OUT / "seed" / f"{seed_name}.png")


def pixel_shadow(draw: ImageDraw.ImageDraw, cx: int, y: int, rx: int, ry: int) -> None:
    draw.ellipse((cx - rx, y - ry, cx + rx, y + ry), fill=rgba("shadow"))
    draw.ellipse((cx - max(1, rx // 2), y - max(1, ry // 2), cx + max(1, rx // 2), y + max(1, ry // 2)), fill=alpha("black", 80))


def rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str | None = "ink") -> None:
    draw.rectangle(box, fill=rgba(fill), outline=rgba(outline) if outline else None)


def diamond(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, fill: str, outline: str = "ink") -> None:
    draw.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=rgba(fill), outline=rgba(outline))


def panel(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    fill: str,
    outline: str = "ink",
    highlight: str | None = None,
    shade: str | None = None,
) -> None:
    draw.rectangle(box, fill=rgba(fill), outline=rgba(outline))
    x1, y1, x2, y2 = box
    if highlight:
        draw.line((x1 + 1, y1 + 1, x2 - 1, y1 + 1), fill=rgba(highlight), width=1)
        draw.line((x1 + 1, y1 + 1, x1 + 1, y2 - 1), fill=rgba(highlight), width=1)
    if shade:
        draw.line((x1 + 1, y2 - 1, x2 - 1, y2 - 1), fill=rgba(shade), width=1)
        draw.line((x2 - 1, y1 + 1, x2 - 1, y2 - 1), fill=rgba(shade), width=1)


def glow(draw: ImageDraw.ImageDraw, cx: int, cy: int, radius: int, color: str, opacity: int = 70) -> None:
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=alpha(color, opacity))
    draw.ellipse((cx - radius // 2, cy - radius // 2, cx + radius // 2, cy + radius // 2), fill=alpha(color, min(180, opacity + 45)))


def spark(draw: ImageDraw.ImageDraw, cx: int, cy: int, color: str, frame: int = 0, size: int = 4) -> None:
    offset = frame % 2
    draw.line((cx - size, cy, cx + size, cy), fill=rgba(color), width=1)
    draw.line((cx, cy - size + offset, cx, cy + size - offset), fill=rgba(color), width=1)
    draw.point((cx, cy), fill=rgba("white"))


def tower_painter(kind: str) -> Painter:
    colors: dict[str, tuple[str, str, str]] = {
        "emberCoil": ("ember", "copper", "gold"),
        "frostLoom": ("blue", "teal", "cream"),
        "bloomMortar": ("green", "moss", "gold"),
        "voltSpire": ("violet", "blue", "teal"),
        "sunForge": ("gold", "ember", "cream"),
    }
    primary, secondary, accent = colors[kind]

    def paint(draw: ImageDraw.ImageDraw, frame: int, _: int, size: int) -> None:
        cx = size // 2
        level = frame + 1
        pulse = frame % 3
        pixel_shadow(draw, cx, size - 7, 24, 6)
        draw.polygon(
            [(cx - 24, size - 18), (cx - 15, size - 27), (cx + 15, size - 27), (cx + 24, size - 18), (cx + 16, size - 9), (cx - 16, size - 9)],
            fill=rgba("stone_dark"),
            outline=rgba("ink"),
        )
        panel(draw, (cx - 18, size - 23, cx + 18, size - 12), "stone", highlight="stone_light", shade="stone_dark")
        draw.line((cx - 23, size - 18, cx + 23, size - 18), fill=rgba("gold"), width=1)
        panel(draw, (cx - 14, size - 40 - level * 2, cx + 14, size - 18), secondary, highlight=accent, shade="dark")
        panel(draw, (cx - 8, size - 51 - level * 3, cx + 8, size - 32), primary, highlight=accent, shade="ink")
        draw.line((cx - 18, size - 31, cx - 25, size - 42), fill=rgba("stone_light"), width=2)
        draw.line((cx + 18, size - 31, cx + 25, size - 42), fill=rgba("stone_light"), width=2)
        for index in range(level):
            y = size - 44 - index * 7
            glow(draw, cx, y, 5 + pulse, accent, 42)
            diamond(draw, cx, y, 5, accent)
        if kind == "bloomMortar":
            draw.ellipse((cx - 18, size - 54, cx + 18, size - 28), fill=rgba("green_dark"), outline=rgba("ink"))
            draw.ellipse((cx - 13, size - 50, cx + 13, size - 31), fill=rgba(primary), outline=rgba("moss_dark"))
            draw.rectangle((cx - 4, size - 60, cx + 5, size - 38), fill=rgba("moss"), outline=rgba("ink"))
            spark(draw, cx + 13, size - 52, "green_light", frame, 3)
        elif kind == "voltSpire":
            draw.line((cx - 20, size - 46, cx, size - 61, cx + 20, size - 46), fill=rgba("teal_light"), width=3)
            draw.line((cx - 13, size - 48, cx, size - 56, cx + 13, size - 48), fill=rgba("violet_light"), width=2)
            spark(draw, cx + (frame - 1) * 7, size - 58, "teal_light", frame, 4)
        elif kind == "sunForge":
            glow(draw, cx, size - 45, 17 + frame, "ember_hot", 68)
            draw.ellipse((cx - 14, size - 58, cx + 14, size - 32), fill=rgba("gold"), outline=rgba("ink"))
            draw.ellipse((cx - 8, size - 52, cx + 8, size - 38), fill=rgba("ember_hot"), outline=rgba("copper_dark"))
        elif kind == "emberCoil":
            for side in (-1, 1):
                draw.arc((cx - 18 * side - 7, size - 51, cx - 18 * side + 8, size - 30), 90, 270, fill=rgba("ember_hot"), width=2)
            spark(draw, cx + 12, size - 52, "ember_hot", frame, 3)
        elif kind == "frostLoom":
            draw.arc((cx - 19, size - 55, cx + 19, size - 30), 20, 160, fill=rgba("ice"), width=2)
            draw.arc((cx - 16, size - 50, cx + 16, size - 28), 200, 340, fill=rgba("blue_light"), width=2)
            spark(draw, cx - 12, size - 50, "ice", frame, 3)

    return paint


def enemy_painter(kind: str) -> Painter:
    colors: dict[str, tuple[str, str]] = {
        "siltling": ("path", "gold"),
        "thornback": ("green", "copper"),
        "glassWisp": ("teal", "blue"),
        "ironMite": ("stone", "ember"),
        "oilSlug": ("oil", "ember"),
        "frostDrone": ("ice", "blue"),
        "ashHusk": ("ash", "violet"),
        "relicEater": ("violet", "gold"),
    }
    primary, accent = colors[kind]

    def paint(draw: ImageDraw.ImageDraw, frame: int, _: int, size: int) -> None:
        cx = size // 2
        bob = [0, -2, 0, 2][frame]
        pixel_shadow(draw, cx, size - 6, 18, 5)
        if kind == "glassWisp":
            glow(draw, cx, 24 + bob, 17, "teal", 54)
            draw.polygon([(cx, 8 + bob), (cx + 17, 22 + bob), (cx + 10, 39 + bob), (cx - 12, 38 + bob), (cx - 18, 20 + bob)], fill=rgba("glass_dark"), outline=rgba("ink"))
            draw.polygon([(cx, 12 + bob), (cx + 11, 23 + bob), (cx + 5, 34 + bob), (cx - 8, 33 + bob), (cx - 12, 22 + bob)], fill=rgba(primary), outline=rgba("teal_light"))
            diamond(draw, cx, 23 + bob, 6, accent)
            draw.arc((cx - 20, 8 + bob, cx + 20, 41 + bob), 205, 330, fill=rgba("cream"), width=2)
        elif kind == "relicEater":
            glow(draw, cx, 24 + bob, 21, "violet", 56)
            draw.ellipse((cx - 19, 11 + bob, cx + 19, 41 + bob), fill=rgba("violet_dark"), outline=rgba("ink"))
            draw.ellipse((cx - 14, 15 + bob, cx + 14, 38 + bob), fill=rgba(primary), outline=rgba("violet_light"))
            rect(draw, (cx - 10, 21 + bob, cx + 10, 33 + bob), "dark")
            draw.rectangle((cx - 7, 23 + bob, cx - 3, 27 + bob), fill=rgba("relic"))
            draw.rectangle((cx + 3, 23 + bob, cx + 7, 27 + bob), fill=rgba("relic"))
            diamond(draw, cx, 12 + bob, 6, accent)
            for side in (-1, 1):
                draw.line((cx + side * 18, 25 + bob, cx + side * 27, 16 + bob), fill=rgba("gold"), width=3)
                draw.line((cx + side * 15, 32 + bob, cx + side * 25, 37 + bob), fill=rgba("violet_light"), width=2)
        elif kind == "oilSlug":
            draw.ellipse((cx - 20, 20 + bob, cx + 18, 41 + bob), fill=rgba("oil"), outline=rgba("ink"))
            draw.ellipse((cx - 10, 12 + bob, cx + 13, 32 + bob), fill=rgba("oil_light"), outline=rgba("ink"))
            draw.line((cx + 8, 17 + bob, cx + 17, 9 + bob), fill=rgba(accent), width=3)
            draw.ellipse((cx - 14, 27 + bob, cx - 7, 33 + bob), fill=rgba("ember_dark"))
            diamond(draw, cx - 5, 24 + bob, 4 + frame % 2, accent)
            spark(draw, cx + 17, 10 + bob, "ember_hot", frame, 3)
        elif kind == "frostDrone":
            glow(draw, cx, 25 + bob, 17, "blue_light", 40)
            diamond(draw, cx, 25 + bob, 18, "ice_dark")
            diamond(draw, cx, 25 + bob, 13, primary, "blue_dark")
            draw.rectangle((cx - 4, 9 + bob, cx + 4, 41 + bob), fill=rgba(accent))
            draw.rectangle((cx - 16, 22 + bob, cx + 16, 28 + bob), fill=rgba("cream"))
            draw.ellipse((cx - 6, 20 + bob, cx + 6, 32 + bob), fill=rgba("blue"), outline=rgba("ink"))
            spark(draw, cx - 15, 16 + bob, "ice", frame, 3)
        elif kind == "ashHusk":
            draw.ellipse((cx - 15, 15 + bob, cx + 15, 41 + bob), fill=rgba("ash"), outline=rgba("ink"))
            draw.polygon([(cx - 13, 19 + bob), (cx, 6 + bob), (cx + 13, 19 + bob)], fill=rgba("dark"), outline=rgba("ink"))
            draw.arc((cx - 20, 10 + bob, cx + 20, 45 + bob), 28, 152, fill=rgba(accent), width=3)
            draw.arc((cx - 16, 16 + bob, cx + 16, 43 + bob), 200, 330, fill=rgba("smoke"), width=2)
            draw.rectangle((cx - 6, 24 + bob, cx + 6, 28 + bob), fill=rgba("cream"))
        else:
            draw.ellipse((cx - 16, 15 + bob, cx + 16, 40 + bob), fill=rgba(primary), outline=rgba("ink"))
            draw.ellipse((cx - 12, 18 + bob, cx + 9, 35 + bob), fill=alpha("white", 24))
            draw.rectangle((cx - 10, 11 + bob, cx + 10, 25 + bob), fill=rgba(primary), outline=rgba("ink"))
            if kind == "thornback":
                for offset in (-12, 0, 12):
                    diamond(draw, cx + offset, 12 + bob, 5, accent)
                draw.line((cx - 16, 29 + bob, cx - 22, 36 + bob), fill=rgba("green_dark"), width=2)
                draw.line((cx + 16, 29 + bob, cx + 22, 36 + bob), fill=rgba("green_dark"), width=2)
            if kind == "ironMite":
                panel(draw, (cx - 13, 19 + bob, cx + 13, 32 + bob), "stone", highlight="stone_light", shade="stone_dark")
                draw.rectangle((cx - 17, 27 + bob, cx - 12, 34 + bob), fill=rgba("stone_dark"), outline=rgba("ink"))
                draw.rectangle((cx + 12, 27 + bob, cx + 17, 34 + bob), fill=rgba("stone_dark"), outline=rgba("ink"))
            if kind == "siltling":
                draw.rectangle((cx - 12, 31 + bob, cx + 12, 36 + bob), fill=rgba("path_dark"))
                draw.line((cx - 14, 26 + bob, cx - 21, 30 + bob), fill=rgba("path_light"), width=2)
            draw.rectangle((cx - 6, 22 + bob, cx - 3, 25 + bob), fill=rgba("cream"))
            draw.rectangle((cx + 3, 22 + bob, cx + 6, 25 + bob), fill=rgba("cream"))

    return paint


def hero_painter(kind: str) -> Painter:
    colors: dict[str, tuple[str, str]] = {
        "kiteRanger": ("teal", "gold"),
        "bulwark": ("copper", "cream"),
        "fieldMechanic": ("violet", "green"),
        "cinderChemist": ("ember", "teal"),
    }
    primary, accent = colors[kind]

    def paint(draw: ImageDraw.ImageDraw, frame: int, _: int, size: int) -> None:
        cx = size // 2
        step = [-2, 0, 2, 0][frame]
        cape = 1 if frame in (1, 2) else -1
        pixel_shadow(draw, cx, size - 5, 17, 5)
        draw.polygon([(cx - 11, 22 + step), (cx - 18, 39 + step), (cx - 4, 38 + step)], fill=alpha(accent, 170), outline=rgba("ink"))
        panel(draw, (cx - 9, 18 + step, cx + 9, 38 + step), primary, highlight="cream", shade="dark")
        draw.rectangle((cx - 10, 34 + step, cx - 4, 42 + step), fill=rgba("dark"))
        draw.rectangle((cx + 3, 34 + step, cx + 9, 42 + step), fill=rgba("dark"))
        draw.ellipse((cx - 8, 9 + step, cx + 8, 24 + step), fill=rgba("cream"), outline=rgba("ink"))
        draw.rectangle((cx - 6, 8 + step, cx + 6, 13 + step), fill=rgba(primary), outline=rgba("ink"))
        if kind == "kiteRanger":
            draw.line((cx + 11, 21 + step, cx + 22, 14 + step), fill=rgba(accent), width=3)
            draw.arc((cx + 11, 11 + step, cx + 28, 30 + step), 90, 270, fill=rgba(accent), width=2)
            draw.line((cx - 11, 21 + step, cx - 18, 28 + step + cape), fill=rgba("teal_dark"), width=2)
            spark(draw, cx + 24, 14 + step, "gold_light", frame, 2)
        elif kind == "bulwark":
            panel(draw, (cx - 23, 18 + step, cx - 10, 40 + step), accent, highlight="white", shade="copper_dark")
            diamond(draw, cx - 16, 27 + step, 5, "gold")
            draw.line((cx + 12, 15 + step, cx + 19, 37 + step), fill=rgba("ink"), width=3)
            draw.line((cx + 13, 17 + step, cx + 20, 37 + step), fill=rgba("stone_light"), width=1)
        elif kind == "cinderChemist":
            panel(draw, (cx + 10, 20 + step, cx + 21, 34 + step), "oil", highlight="oil_light", shade="black")
            draw.ellipse((cx + 13, 13 + step, cx + 23, 23 + step), fill=rgba(accent), outline=rgba("ink"))
            draw.line((cx - 12, 30 + step, cx - 23, 19 + step), fill=rgba("ember"), width=3)
            spark(draw, cx - 24, 18 + step, "ember_hot", frame, 3)
        else:
            panel(draw, (cx + 10, 22 + step, cx + 21, 33 + step), accent, highlight="green_light", shade="moss_dark")
            draw.line((cx - 14, 29 + step, cx - 23, 35 + step), fill=rgba("gold"), width=3)
            draw.line((cx + 16, 18 + step, cx + 25, 12 + step), fill=rgba("violet_light"), width=2)

    return paint


def machine_painter(draw: ImageDraw.ImageDraw, frame: int, _: int, size: int) -> None:
    cx = size // 2
    pulse = frame % 4
    pixel_shadow(draw, cx, size - 6, 18, 5)
    panel(draw, (cx - 18, 25, cx + 18, 40), "stone_dark", highlight="stone_light", shade="black")
    panel(draw, (cx - 13, 15, cx + 13, 31), "violet_dark", highlight="violet_light", shade="black")
    glow(draw, cx, 15, 10 + (pulse % 2), "teal", 54)
    diamond(draw, cx, 14, 8 + (pulse % 2), "teal_light")
    draw.arc((cx - 17, 12, cx + 17, 37), 25 + pulse * 12, 165 + pulse * 12, fill=rgba("gold"), width=2)
    draw.line((cx - 20, 31, cx - 29, 24 + pulse), fill=rgba("gold_light"), width=2)
    draw.line((cx + 20, 31, cx + 29, 24 + pulse), fill=rgba("gold_light"), width=2)
    draw.rectangle((cx - 4, 32, cx + 4, 38), fill=rgba("teal_dark"))


def projectile_painter(draw: ImageDraw.ImageDraw, frame: int, _: int, size: int) -> None:
    colors = ["ember_hot", "blue_light", "green_light", "violet_light", "gold_light", "cream"]
    color = colors[frame]
    cx = size // 2
    glow(draw, cx, cx, 10, color, 50)
    draw.line((cx - 10, cx + 4, cx + 7, cx - 5), fill=alpha(color, 155), width=3)
    diamond(draw, cx, cx, 7, color)
    draw.ellipse((cx - 3, cx - 3, cx + 3, cx + 3), fill=rgba("white"))


def tile_painter(draw: ImageDraw.ImageDraw, frame: int, _: int, size: int) -> None:
    if frame == 0:
        draw.rectangle((0, 0, size, size), fill=(45, 82, 61, 255))
        for y in range(0, size, 12):
            draw.line((0, y + 9, size, y + 4), fill=(39, 72, 53, 255), width=1)
        for x in range(3, size, 10):
            draw.line((x, size - 5, x + 5, size - 12), fill=(94, 145, 75, 255), width=2)
            if x % 20 == 3:
                draw.point((x + 3, size - 14), fill=rgba("gold"))
    elif frame == 1:
        draw.rectangle((0, 0, size, size), fill=rgba("path_dark"))
        draw.rectangle((0, 16, size, 32), fill=rgba("path"))
        draw.line((0, 16, size, 16), fill=rgba("path_light"), width=2)
        draw.line((0, 32, size, 32), fill=rgba("black"), width=1)
        for x in range(0, size, 12):
            draw.rectangle((x, 23, x + 5, 27), fill=rgba("path_light"))
            draw.rectangle((x + 7, 19, x + 10, 21), fill=rgba("stone_dark"))
    elif frame == 2:
        draw.rectangle((0, 0, size, size), fill=rgba("stone_dark"))
        for box in [(3, 3, 23, 19), (24, 4, 44, 17), (5, 24, 20, 43), (24, 25, 45, 44)]:
            panel(draw, box, "stone", highlight="stone_light", shade="black")
    elif frame == 3:
        draw.rectangle((0, 0, size, size), fill=(26, 74, 96, 255))
        draw.rectangle((0, 0, size, size // 2), fill=(34, 99, 124, 255))
        for y in range(8, size, 13):
            draw.arc((4, y - 5, size - 4, y + 8), 10, 170, fill=rgba("blue_light"), width=2)
            draw.arc((10, y, size - 8, y + 12), 190, 340, fill=rgba("teal_light"), width=1)
    elif frame == 4:
        draw.rectangle((0, 0, size, size), fill=(54, 80, 64, 255))
        draw.rounded_rectangle((7, 7, size - 7, size - 7), radius=7, fill=(75, 66, 59, 255), outline=rgba("gold"), width=2)
        draw.line((10, 11, size - 10, 11), fill=rgba("gold_light"), width=1)
        diamond(draw, size // 2, size // 2, 8, "teal_light")
    elif frame == 5:
        draw.rectangle((0, 0, size, size), fill=(69, 57, 72, 255))
        glow(draw, size // 2, size // 2, 17, "violet", 48)
        draw.rounded_rectangle((6, 8, size - 6, size - 6), radius=8, fill=(42, 35, 52, 255), outline=rgba("gold"), width=2)
        diamond(draw, size // 2, size // 2, 12, "violet_light")
    elif frame == 6:
        draw.rectangle((0, 0, size, size), fill=(58, 69, 50, 255))
        draw.line((0, 9, size, 4), fill=rgba("moss_dark"), width=2)
        for offset in (10, 24, 37):
            diamond(draw, offset, 30 - offset % 7, 5, "copper")
            draw.point((offset + 4, 28 - offset % 7), fill=rgba("gold_light"))
    else:
        draw.rectangle((0, 0, size, size), fill=(39, 82, 68, 255))
        draw.ellipse((12, 10, 36, 36), fill=(66, 126, 78, 255), outline=rgba("moss_dark"))
        draw.ellipse((17, 15, 31, 30), fill=rgba("green_light"))
        diamond(draw, 24, 22, 5, "gold_light")


def tool_icon_painter(draw: ImageDraw.ImageDraw, frame: int, _: int, size: int) -> None:
    cx = size // 2
    pixel_shadow(draw, cx, size - 5, 14, 3)
    if frame == 0:
        panel(draw, (10, 27, 19, 36), "copper", highlight="gold_light", shade="copper_dark")
        draw.line((16, 33, 36, 12), fill=rgba("stone_dark"), width=7)
        draw.line((16, 33, 36, 12), fill=rgba("cream"), width=2)
        spark(draw, 36, 12, "teal_light", frame, 2)
    elif frame == 1:
        draw.arc((9, 9, 39, 39), 35, 310, fill=rgba("teal_light"), width=5)
        draw.arc((13, 13, 35, 35), 180, 30, fill=rgba("blue"), width=2)
        diamond(draw, cx, cx, 8, "gold_light")
    elif frame == 2:
        panel(draw, (13, 13, 35, 35), "green", highlight="green_light", shade="green_dark")
        draw.line((24, 10, 24, 38), fill=rgba("cream"), width=3)
        draw.line((10, 24, 38, 24), fill=rgba("cream"), width=3)
    else:
        glow(draw, cx, cx, 16, "violet", 48)
        draw.ellipse((10, 10, 38, 38), fill=rgba("violet_dark"), outline=rgba("ink"))
        diamond(draw, cx, cx, 10, "teal_light")
        spark(draw, 36, 14, "gold_light", frame, 2)


def write_manifest() -> None:
    manifest = {
        "frameAnchors": "bottom-center for characters/towers, center for tools/fx",
        "terrain": {"key": "terrain:tiles", "path": "terrain/tiles.png", "frameWidth": 48, "frameHeight": 48, "frames": 8},
        "enemies": {
            key: {"key": f"enemy:{key}", "path": f"enemies/{key}.png", "frameWidth": 48, "frameHeight": 48, "frames": 4}
            for key in ["siltling", "thornback", "glassWisp", "ironMite", "oilSlug", "frostDrone", "ashHusk", "relicEater"]
        },
        "towers": {
            key: {"key": f"tower:{key}", "path": f"towers/{key}.png", "frameWidth": 64, "frameHeight": 64, "frames": 3}
            for key in ["emberCoil", "frostLoom", "bloomMortar", "voltSpire", "sunForge"]
        },
        "heroes": {
            key: {"key": f"hero:{key}", "path": f"heroes/{key}.png", "frameWidth": 48, "frameHeight": 48, "frames": 4}
            for key in ["kiteRanger", "bulwark", "fieldMechanic", "cinderChemist"]
        },
        "machines": {"aetherMill": {"key": "machine:aetherMill", "path": "machines/aether-mill.png", "frameWidth": 48, "frameHeight": 48, "frames": 4}},
        "tools": {"path": "tools/tools.png", "frameWidth": 48, "frameHeight": 48, "frames": 4},
        "powerups": {"path": "powerups/powerups.png", "frameWidth": 48, "frameHeight": 48, "frames": 4},
        "relics": {"path": "relics/relics.png", "frameWidth": 48, "frameHeight": 48, "frames": 6},
        "fx": {"projectiles": {"key": "fx:projectiles", "path": "fx/projectiles.png", "frameWidth": 24, "frameHeight": 24, "frames": 6}},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def write_pipeline_notes() -> None:
    notes = """# Sprite Pipeline Notes

Relic Line uses deterministic PNG strips generated from seed poses so the game can build without an external image API.

- Each character, tower, hero, and machine has a seed frame in `seed/`.
- Each runtime strip is generated as one whole strip with a fixed frame count.
- Characters use bottom-center anchoring inside 48x48 frames; towers use bottom-center inside 64x64 frames.
- `preview/preview-sheet.png` is the inspection artifact for the current asset set.
- The prompt shape for an AI edit pass would be: same silhouette family, same palette family, same facing direction, transparent background, exact frame count, crisp pixel-art clusters, no labels, no scenery.
"""
    (OUT / "SPRITE_PIPELINE.md").write_text(notes, encoding="utf-8")


def preview_sheet(paths: Iterable[Path]) -> None:
    thumbs: list[Image.Image] = []
    for path in paths:
        source = Image.open(path).convert("RGBA")
        frame_width = 48
        if "towers" in path.parts:
            frame_width = 64
        elif "fx" in path.parts:
            frame_width = 24
        frame = source.crop((0, 0, frame_width, source.height))
        tile = Image.new("RGBA", (64, 64), (238, 232, 214, 255))
        for x in range(0, 64, 8):
            for y in range(0, 64, 8):
                if (x // 8 + y // 8) % 2:
                    ImageDraw.Draw(tile).rectangle((x, y, x + 7, y + 7), fill=(219, 213, 198, 255))
        tile.alpha_composite(frame, ((64 - frame.width) // 2, 64 - frame.height))
        thumbs.append(tile)

    columns = 6
    rows = math.ceil(len(thumbs) / columns)
    sheet_image = Image.new("RGBA", (columns * 72 - 8, rows * 72 - 8), (32, 31, 30, 255))
    for index, thumb in enumerate(thumbs):
        x = (index % columns) * 72
        y = (index // columns) * 72
        sheet_image.alpha_composite(thumb, (x, y))
    sheet_image.save(OUT / "preview" / "preview-sheet.png")


def main() -> None:
    clean()
    generated: list[Path] = []

    terrain = OUT / "terrain" / "tiles.png"
    save_strip(terrain, 48, 8, tile_painter, "terrain-grass")
    generated.append(terrain)

    for kind in ["emberCoil", "frostLoom", "bloomMortar", "voltSpire", "sunForge"]:
        path = OUT / "towers" / f"{kind}.png"
        save_strip(path, 64, 3, tower_painter(kind), f"tower-{kind}")
        generated.append(path)

    for kind in ["siltling", "thornback", "glassWisp", "ironMite", "oilSlug", "frostDrone", "ashHusk", "relicEater"]:
        path = OUT / "enemies" / f"{kind}.png"
        save_strip(path, 48, 4, enemy_painter(kind), f"enemy-{kind}")
        generated.append(path)

    for kind in ["kiteRanger", "bulwark", "fieldMechanic", "cinderChemist"]:
        path = OUT / "heroes" / f"{kind}.png"
        save_strip(path, 48, 4, hero_painter(kind), f"hero-{kind}")
        generated.append(path)

    machine = OUT / "machines" / "aether-mill.png"
    save_strip(machine, 48, 4, machine_painter, "machine-aether-mill")
    generated.append(machine)

    tools = OUT / "tools" / "tools.png"
    save_strip(tools, 48, 4, tool_icon_painter, "tool-spanner")
    generated.append(tools)

    powerups = OUT / "powerups" / "powerups.png"
    save_strip(powerups, 48, 4, tool_icon_painter, "powerup-branch")
    generated.append(powerups)

    relics = OUT / "relics" / "relics.png"
    save_strip(relics, 48, 6, tool_icon_painter, "relic-ember-lens")
    generated.append(relics)

    fx = OUT / "fx" / "projectiles.png"
    save_strip(fx, 24, 6, projectile_painter, "projectile-ember")
    generated.append(fx)

    write_manifest()
    write_pipeline_notes()
    preview_sheet(generated)
    print(f"Generated {len(generated)} sprite strips in {OUT}")


if __name__ == "__main__":
    main()
