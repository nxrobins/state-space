from __future__ import annotations

import json
import math
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "public" / "assets" / "sprites" / "fighters" / "water"
MANIFEST = ROOT / "public" / "assets" / "sprites" / "fighters" / "manifest.json"
STAGE = ROOT / "public" / "assets" / "sprites" / "staged" / "water-platform-v1"
FRAME_SIZE = 96
GROUND_Y = 84
CENTER_X = 48

WATER_ANIMATIONS: dict[str, dict[str, int | bool]] = {
    "idle": {"frames": 6, "fps": 2, "loop": True},
    "run": {"frames": 8, "fps": 14, "loop": True},
    "jump": {"frames": 4, "fps": 10, "loop": False},
    "fall": {"frames": 4, "fps": 10, "loop": False},
    "shield": {"frames": 4, "fps": 10, "loop": True},
    "hurt": {"frames": 4, "fps": 12, "loop": False},
    "grab": {"frames": 6, "fps": 13, "loop": False},
    "attack-neutral": {"frames": 6, "fps": 16, "loop": False},
    "attack-side": {"frames": 6, "fps": 15, "loop": False},
    "attack-up": {"frames": 6, "fps": 15, "loop": False},
    "attack-down": {"frames": 6, "fps": 15, "loop": False},
    "air-neutral": {"frames": 6, "fps": 15, "loop": False},
    "air-forward": {"frames": 6, "fps": 15, "loop": False},
    "air-back": {"frames": 6, "fps": 15, "loop": False},
    "air-up": {"frames": 6, "fps": 15, "loop": False},
    "air-down": {"frames": 6, "fps": 15, "loop": False},
    "special-neutral": {"frames": 8, "fps": 14, "loop": False},
    "special-side": {"frames": 8, "fps": 14, "loop": False},
    "special-up": {"frames": 8, "fps": 14, "loop": False},
    "special-down": {"frames": 8, "fps": 14, "loop": False},
    "ko": {"frames": 6, "fps": 8, "loop": False},
}

LEGACY_ALIASES = {
    "block": "shield",
    "basic": "attack-neutral",
    "special1": "special-neutral",
    "special2": "special-down",
    "special3": "special-up",
}

PALETTE = {
    "outline": (2, 8, 18, 255),
    "inner_outline": (5, 24, 48, 255),
    "shadow": (0, 6, 12, 96),
    "skin": (199, 145, 103, 255),
    "skin_light": (226, 171, 122, 255),
    "skin_dark": (139, 84, 58, 255),
    "hair": (12, 18, 25, 255),
    "hair_light": (35, 52, 66, 255),
    "robe": (32, 115, 217, 255),
    "robe_dark": (12, 45, 104, 255),
    "robe_light": (96, 188, 255, 255),
    "robe_shadow": (5, 28, 70, 255),
    "sash": (205, 237, 247, 255),
    "trim": (117, 231, 255, 255),
    "boot": (6, 20, 45, 255),
    "water": (82, 206, 255, 225),
    "water_dark": (26, 111, 218, 220),
    "foam": (223, 252, 255, 236),
    "ice": (181, 245, 255, 238),
}


def main() -> None:
    reset_stage()
    prompts_path = STAGE / "prompts.md"
    prompts_path.write_text(sprite_prompts(), encoding="utf-8")

    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "frames").mkdir(exist_ok=True)
    preview_frames: list[Path] = []

    rendered: dict[str, list[Image.Image]] = {}
    for animation, info in WATER_ANIMATIONS.items():
        frames = [render_frame(animation, index, int(info["frames"])) for index in range(int(info["frames"]))]
        rendered[animation] = frames
        write_animation(animation, frames, preview_frames)

    for alias, source in LEGACY_ALIASES.items():
        write_animation(alias, rendered[source], preview_frames)

    seed = rendered["idle"][0]
    seed.save(STAGE / "seed" / "water-platform-idle-seed.png")
    save_preview_frames(preview_frames, RUNTIME / "preview-frames")
    save_preview_sheet(preview_frames, RUNTIME / "preview.png")
    (RUNTIME / "preview-frame-list.json").write_text(
        json.dumps([str(path.relative_to(RUNTIME)).replace("\\", "/") for path in preview_frames], indent=2),
        encoding="utf-8",
    )
    update_manifest()


def reset_stage() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    for child in ["seed", "raw-strips", "normalized", "previews"]:
        (STAGE / child).mkdir(parents=True, exist_ok=True)


def write_animation(animation: str, frames: list[Image.Image], preview_frames: list[Path]) -> None:
    frame_dir = RUNTIME / "frames" / animation
    stage_frame_dir = STAGE / "normalized" / animation
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True, exist_ok=True)
    stage_frame_dir.mkdir(parents=True, exist_ok=True)

    sheet = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        frame_path = frame_dir / f"frame-{index + 1:02d}.png"
        stage_path = stage_frame_dir / f"frame-{index + 1:02d}.png"
        frame.save(frame_path)
        frame.save(stage_path)
        sheet.alpha_composite(frame, (index * FRAME_SIZE, 0))
        if index in preview_indices(len(frames)):
            preview_frames.append(frame_path)

    sheet.save(RUNTIME / f"{animation}.png")
    sheet.save(STAGE / "raw-strips" / f"{animation}-raw.png")
    render_small_preview(frames, STAGE / "previews" / f"{animation}-preview.png")


def render_frame(animation: str, frame: int, total: int) -> Image.Image:
    image = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    t = frame / max(1, total - 1)
    wave = math.sin(t * math.tau)
    pose = pose_for(animation, t, wave)
    if animation == "ko" and frame >= 2:
        draw_ko(draw, pose, t)
        return image

    draw_shadow(draw, pose)
    draw_water_fx(draw, animation, t, pose, behind=True)
    draw_body(draw, pose)
    draw_water_fx(draw, animation, t, pose, behind=False)
    if animation == "hurt":
        draw_hurt_slashes(draw, t)
    return image


def pose_for(animation: str, t: float, wave: float) -> dict[str, Any]:
    pose: dict[str, Any] = {
        "x": CENTER_X,
        "y": GROUND_Y - 32,
        "bob": round(math.sin(t * math.tau) * 1.3),
        "lean": 0,
        "crouch": 0,
        "head_dx": 0,
        "head_dy": 0,
        "torso_w": 31,
        "left_arm": (-15, -1, -27, 17),
        "right_arm": (15, -2, 31, 9),
        "left_leg": (-9, 29, -18, 50),
        "right_leg": (10, 29, 18, 50),
        "fx": "idle",
    }

    if animation == "run":
        pose.update({
            "bob": round(abs(wave) * 2),
            "lean": 5,
            "left_arm": (-10, -1, -26 + int(wave * 6), 14),
            "right_arm": (11, -2, 27 - int(wave * 6), 10),
            "left_leg": (-8, 28, -18 + int(wave * 7), 49),
            "right_leg": (8, 28, 18 - int(wave * 7), 49),
            "fx": "speed",
        })
    elif animation == "jump":
        pose.update({"bob": -5 - round(t * 4), "crouch": -2, "left_leg": (-7, 28, -12, 42), "right_leg": (8, 28, 15, 42), "fx": "lift"})
    elif animation == "fall":
        pose.update({"bob": 2 + round(t * 4), "lean": -2, "left_arm": (-12, 2, -20, 25), "right_arm": (11, 0, 23, 22), "fx": "fall"})
    elif animation == "shield":
        pose.update({"crouch": 3, "left_arm": (-12, 2, -20, 18), "right_arm": (12, 2, 21, 18), "fx": "shield"})
    elif animation == "hurt":
        pose.update({"lean": -8, "head_dx": -4, "left_arm": (-15, 0, -29, 5), "right_arm": (10, 2, 19, 20), "fx": "none"})
    elif animation == "grab":
        reach = int(18 + math.sin(t * math.pi) * 13)
        pose.update({"lean": 6, "right_arm": (13, -3, reach, 4), "left_arm": (-11, 2, -20, 16), "fx": "grab"})
    elif animation == "attack-neutral":
        reach = int(24 + math.sin(t * math.pi) * 12)
        pose.update({"lean": 5, "right_arm": (12, -2, reach, 3), "left_arm": (-13, 2, -22, 15), "fx": "jab"})
    elif animation == "attack-side":
        reach = int(29 + math.sin(t * math.pi) * 18)
        pose.update({"lean": 8, "right_arm": (12, -3, reach, 2), "left_leg": (-8, 28, -20, 47), "right_leg": (7, 28, 19, 46), "fx": "side"})
    elif animation == "attack-up":
        lift = int(math.sin(t * math.pi) * 18)
        pose.update({"lean": -2, "right_arm": (8, -5, 14, -28 - lift), "left_arm": (-12, 0, -20, 14), "fx": "up"})
    elif animation == "attack-down":
        sweep = int(math.sin(t * math.pi) * 24)
        pose.update({"crouch": 8, "right_arm": (12, 7, 29 + sweep, 24), "left_leg": (-8, 28, -22, 45), "right_leg": (8, 28, 25, 43), "fx": "low"})
    elif animation.startswith("air-"):
        pose.update({"bob": -8, "crouch": -1, "left_leg": (-7, 28, -14, 40), "right_leg": (8, 28, 15, 42)})
        if animation == "air-neutral":
            pose.update({"right_arm": (12, 0, 27, 9), "left_arm": (-12, 0, -27, 9), "fx": "wheel"})
        elif animation == "air-forward":
            pose.update({"lean": 7, "right_arm": (13, -5, 38, -2), "fx": "side"})
        elif animation == "air-back":
            pose.update({"lean": -4, "left_arm": (-12, -4, -36, 1), "right_arm": (12, 2, 21, 14), "fx": "back"})
        elif animation == "air-up":
            pose.update({"right_arm": (8, -6, 12, -30), "fx": "up"})
        elif animation == "air-down":
            pose.update({"right_arm": (10, 5, 15, 36), "left_arm": (-12, 2, -18, 20), "fx": "down"})
    elif animation == "special-neutral":
        reach = int(35 + math.sin(t * math.pi) * 31)
        pose.update({"lean": 7, "right_arm": (13, -4, reach, -4), "fx": "lash"})
    elif animation == "special-side":
        pose.update({"lean": 10, "crouch": 1, "right_arm": (13, -1, 31, 7), "left_leg": (-8, 28, -18, 43), "right_leg": (8, 28, 17, 40), "fx": "surf"})
    elif animation == "special-up":
        pose.update({"bob": -10 - round(math.sin(t * math.pi) * 9), "right_arm": (8, -6, 14, -31), "left_arm": (-10, -4, -16, -22), "fx": "steam"})
    elif animation == "special-down":
        pose.update({"crouch": 10, "right_arm": (12, 8, 35, 27), "left_arm": (-13, 8, -23, 24), "fx": "ice"})
    return pose


def draw_shadow(draw: ImageDraw.ImageDraw, pose: dict[str, Any]) -> None:
    x = pose["x"]
    width = 44 + abs(pose.get("lean", 0)) * 2
    draw.ellipse((x - width // 2, GROUND_Y - 5, x + width // 2, GROUND_Y + 4), fill=PALETTE["shadow"])


def draw_body(draw: ImageDraw.ImageDraw, pose: dict[str, Any]) -> None:
    x = pose["x"] + pose.get("lean", 0)
    y = pose["y"] + pose.get("bob", 0) + pose.get("crouch", 0)
    torso_w = pose["torso_w"]
    outline = PALETTE["outline"]

    draw_leg(draw, x, y, pose["left_leg"], side=-1)
    draw_leg(draw, x, y, pose["right_leg"], side=1)
    draw_arm(draw, x, y, pose["left_arm"], back=True)
    draw_arm(draw, x, y, pose["right_arm"], back=False)

    draw.polygon([(x - 24, y - 14), (x - 11, y - 19), (x - 4, y - 9), (x - 19, y - 5)], fill=outline)
    draw.polygon([(x + 22, y - 15), (x + 9, y - 19), (x + 3, y - 9), (x + 17, y - 5)], fill=outline)
    draw.polygon([(x - 21, y - 13), (x - 11, y - 16), (x - 6, y - 9), (x - 18, y - 7)], fill=PALETTE["robe_dark"])
    draw.polygon([(x + 19, y - 13), (x + 10, y - 16), (x + 5, y - 9), (x + 16, y - 7)], fill=PALETTE["robe_light"])

    torso = [
        (x - torso_w // 2 - 2, y - 12),
        (x + torso_w // 2 + 2, y - 13),
        (x + torso_w // 2 - 3, y + 33),
        (x - torso_w // 2 - 7, y + 35),
    ]
    draw.polygon(expand_poly(torso, 3), fill=outline)
    draw.polygon(torso, fill=PALETTE["robe"])
    draw.polygon([(x - 15, y - 8), (x + 9, y - 11), (x + 3, y + 33), (x - 19, y + 35)], fill=PALETTE["robe_dark"])
    draw.polygon([(x + 1, y - 10), (x + 16, y - 11), (x + 10, y + 31), (x + 2, y + 33)], fill=PALETTE["robe_light"])
    draw.line((x - 16, y - 7, x + 16, y + 27), fill=outline, width=7)
    draw.line((x - 16, y - 7, x + 16, y + 27), fill=PALETTE["sash"], width=4)
    draw.line((x - 18, y + 33, x + 13, y + 31), fill=PALETTE["trim"], width=2)
    draw.rectangle((x - 17, y + 9, x + 16, y + 15), fill=outline)
    draw.rectangle((x - 14, y + 10, x + 14, y + 13), fill=PALETTE["inner_outline"])
    draw.rectangle((x - 3, y + 9, x + 4, y + 15), fill=PALETTE["foam"])
    draw.line((x + 8, y + 17, x + 16, y + 31), fill=PALETTE["outline"], width=4)
    draw.line((x + 8, y + 17, x + 14, y + 30), fill=PALETTE["water"], width=2)

    hx = x + pose.get("head_dx", 0)
    hy = y - 26 + pose.get("head_dy", 0)
    draw.rectangle((hx - 4, hy + 8, hx + 5, hy + 17), fill=outline)
    draw.rectangle((hx - 3, hy + 8, hx + 4, hy + 16), fill=PALETTE["skin_dark"])
    draw.ellipse((hx - 13, hy - 13, hx + 13, hy + 11), fill=outline)
    draw.ellipse((hx - 10, hy - 10, hx + 10, hy + 8), fill=PALETTE["skin"])
    draw.rectangle((hx - 8, hy + 2, hx + 9, hy + 7), fill=PALETTE["skin_dark"])
    draw.rectangle((hx - 3, hy - 2, hx + 8, hy + 1), fill=outline)
    draw.rectangle((hx + 4, hy - 2, hx + 6, hy), fill=PALETTE["foam"])
    draw.rectangle((hx + 9, hy + 3, hx + 13, hy + 5), fill=PALETTE["skin_light"])
    draw.polygon([(hx - 14, hy - 11), (hx + 12, hy - 15), (hx + 7, hy - 4), (hx - 14, hy - 2)], fill=PALETTE["hair"])
    draw.polygon([(hx - 9, hy - 12), (hx + 11, hy - 15), (hx + 5, hy - 9), (hx - 10, hy - 7)], fill=PALETTE["hair_light"])
    draw.rectangle((hx - 15, hy - 5, hx - 10, hy + 2), fill=PALETTE["hair"])
    draw.rectangle((hx + 7, hy - 14, hx + 14, hy - 9), fill=outline)
    draw.rectangle((hx + 8, hy - 13, hx + 13, hy - 10), fill=PALETTE["hair"])


def draw_arm(draw: ImageDraw.ImageDraw, x: int, y: int, arm: tuple[int, int, int, int], back: bool) -> None:
    x1, y1, x2, y2 = arm
    shade = PALETTE["skin_dark"] if back else PALETTE["skin"]
    draw.line((x + x1, y + y1, x + x2, y + y2), fill=PALETTE["outline"], width=12)
    draw.line((x + x1, y + y1, x + x2, y + y2), fill=shade, width=8)
    draw.line((x + x1, y + y1 - 1, x + x2, y + y2 - 1), fill=PALETTE["skin_light"], width=2)
    draw.ellipse((x + x2 - 6, y + y2 - 6, x + x2 + 6, y + y2 + 6), fill=PALETTE["outline"])
    draw.ellipse((x + x2 - 4, y + y2 - 4, x + x2 + 4, y + y2 + 4), fill=PALETTE["skin"])


def draw_leg(draw: ImageDraw.ImageDraw, x: int, y: int, leg: tuple[int, int, int, int], side: int) -> None:
    x1, y1, x2, y2 = leg
    draw.line((x + x1, y + y1, x + x2, y + y2), fill=PALETTE["outline"], width=13)
    draw.line((x + x1, y + y1, x + x2, y + y2), fill=PALETTE["robe_shadow"], width=9)
    draw.line((x + x1 + side, y + y1, x + x2 + side, y + y2 - 4), fill=PALETTE["robe_dark"], width=5)
    foot = [
        (x + x2 - 6, y + y2 - 3),
        (x + x2 + side * 9, y + y2 - 3),
        (x + x2 + side * 11, y + y2 + 2),
        (x + x2 - 7, y + y2 + 3),
    ]
    draw.polygon(expand_poly(foot, 1), fill=PALETTE["outline"])
    draw.polygon(foot, fill=PALETTE["boot"])


def draw_fx_stroke(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    width: int,
    color: tuple[int, int, int, int],
    outline_width: int = 2,
) -> None:
    draw.line(points, fill=PALETTE["outline"], width=width + outline_width * 2)
    draw.line(points, fill=color, width=width)
    if width >= 5:
        draw.line(points, fill=PALETTE["foam"], width=2)


def draw_droplet(draw: ImageDraw.ImageDraw, x: int, y: int, radius: int = 2) -> None:
    draw.rectangle((x - radius - 1, y - radius - 1, x + radius + 1, y + radius + 1), fill=PALETTE["outline"])
    draw.rectangle((x - radius, y - radius, x + radius, y + radius), fill=PALETTE["water"])


def draw_water_fx(draw: ImageDraw.ImageDraw, animation: str, t: float, pose: dict[str, Any], behind: bool) -> None:
    fx = pose.get("fx", "idle")
    x = pose["x"] + pose.get("lean", 0)
    y = pose["y"] + pose.get("bob", 0) + pose.get("crouch", 0)
    water = PALETTE["water"]
    water_dark = PALETTE["water_dark"]
    ice = PALETTE["ice"]

    if fx == "none":
        return
    if behind and fx in {"idle", "speed", "lift", "fall"}:
        draw_fx_stroke(draw, [(x - 28, y + 23), (x - 14, y - 3), (x + 6, y - 19), (x + 31, y - 17)], 4, water_dark, 2)
        draw_droplet(draw, x + 32, y - 20, 1)
    if not behind and fx == "shield":
        draw.arc((x - 35, y - 31, x + 39, y + 43), 278, 96, fill=PALETTE["outline"], width=8)
        draw.arc((x - 35, y - 31, x + 39, y + 43), 278, 96, fill=ice, width=5)
        draw.arc((x - 26, y - 23, x + 30, y + 35), 284, 94, fill=water, width=3)
        draw.rectangle((x + 28, y + 1, x + 35, y + 8), fill=PALETTE["foam"])
    if not behind and fx in {"jab", "grab"}:
        draw_fx_stroke(draw, [(x + 10, y + 3), (x + 26, y - 8), (x + 49, y - 5)], 5, water, 2)
        draw_droplet(draw, x + 54, y - 7, 1)
    if not behind and fx == "side":
        draw_fx_stroke(draw, [(x + 12, y + 6), (x + 33, y - 3), (x + 62, y - 6)], 7, water, 2)
        draw.polygon([(x + 58, y - 12), (x + 74, y - 7), (x + 59, y + 0)], fill=PALETTE["outline"])
        draw.polygon([(x + 58, y - 10), (x + 70, y - 7), (x + 59, y - 2)], fill=ice)
    if not behind and fx == "up":
        draw_fx_stroke(draw, [(x + 5, y - 8), (x + 8, y - 30), (x + 20, y - 55), (x + 17, y - 72)], 6, water, 2)
        draw_droplet(draw, x + 24, y - 62, 2)
        draw_droplet(draw, x + 7, y - 70, 1)
    if not behind and fx == "low":
        draw_fx_stroke(draw, [(x + 2, y + 23), (x + 19, y + 27), (x + 40, y + 24)], 7, water, 2)
        draw.polygon([(x + 36, y + 18), (x + 50, y + 24), (x + 36, y + 30)], fill=PALETTE["outline"])
        draw.polygon([(x + 37, y + 21), (x + 47, y + 24), (x + 37, y + 27)], fill=ice)
    if not behind and fx == "wheel":
        start = int(t * 120)
        draw.arc((x - 35, y - 38, x + 37, y + 35), start, start + 280, fill=PALETTE["outline"], width=8)
        draw.arc((x - 35, y - 38, x + 37, y + 35), start, start + 280, fill=water, width=5)
        draw_droplet(draw, x - 28, y - 19, 1)
        draw_droplet(draw, x + 30, y + 13, 1)
    if not behind and fx == "back":
        draw_fx_stroke(draw, [(x - 9, y + 5), (x - 31, y - 4), (x - 58, y + 2)], 6, water, 2)
        draw.polygon([(x - 59, y - 5), (x - 72, y + 2), (x - 58, y + 9)], fill=PALETTE["outline"])
        draw.polygon([(x - 58, y - 2), (x - 68, y + 2), (x - 58, y + 6)], fill=ice)
    if not behind and fx == "down":
        draw_fx_stroke(draw, [(x + 8, y + 10), (x + 13, y + 33), (x + 18, y + 59)], 6, water, 2)
        draw.polygon([(x + 11, y + 55), (x + 23, y + 70), (x + 2, y + 70)], fill=PALETTE["outline"])
        draw.polygon([(x + 12, y + 57), (x + 19, y + 67), (x + 6, y + 67)], fill=ice)
    if not behind and fx == "lash":
        draw_fx_stroke(draw, [(x + 15, y - 3), (x + 36, y - 23), (x + 69, y - 18), (x + 86, y - 1)], 6, water, 2)
        draw_fx_stroke(draw, [(x + 24, y + 9), (x + 54, y + 17), (x + 83, y + 9)], 4, water_dark, 2)
    if behind and fx == "surf":
        draw_fx_stroke(draw, [(x - 38, y + 22), (x - 16, y + 16), (x + 10, y + 21), (x + 32, y + 27)], 10, water, 2)
        draw_fx_stroke(draw, [(x - 25, y + 29), (x + 7, y + 31), (x + 27, y + 27)], 4, PALETTE["foam"], 1)
    if not behind and fx == "surf":
        draw_fx_stroke(draw, [(x + 9, y + 13), (x + 23, y + 7), (x + 38, y + 14)], 5, water_dark, 2)
        draw.polygon([(x + 32, y + 4), (x + 45, y + 14), (x + 29, y + 18)], fill=PALETTE["outline"])
        draw.polygon([(x + 33, y + 7), (x + 41, y + 14), (x + 31, y + 15)], fill=PALETTE["foam"])
    if behind and fx == "steam":
        for offset in (-16, 0, 16):
            draw_fx_stroke(draw, [(x + offset - 3, y + 43), (x + offset + 6, y + 25), (x + offset + 1, y + 5)], 4, (226, 247, 255, 180), 1)
    if not behind and fx == "ice":
        draw.polygon([(x + 17, y + 24), (x + 31, y + 16), (x + 47, y + 25), (x + 34, y + 34)], fill=PALETTE["outline"])
        draw.polygon([(x + 20, y + 25), (x + 31, y + 19), (x + 43, y + 25), (x + 33, y + 31)], fill=ice)
        draw_fx_stroke(draw, [(x + 11, y + 36), (x + 31, y + 34), (x + 51, y + 37)], 4, water, 1)


def draw_hurt_slashes(draw: ImageDraw.ImageDraw, t: float) -> None:
    alpha = int(210 * (1 - t * 0.5))
    color = (255, 98, 82, alpha)
    draw.line((28, 23, 15, 12), fill=color, width=3)
    draw.line((33, 30, 21, 20), fill=color, width=2)


def draw_ko(draw: ImageDraw.ImageDraw, pose: dict[str, Any], t: float) -> None:
    y = GROUND_Y - 11 + int(t * 3)
    x = CENTER_X - 3
    draw.ellipse((x - 24, y + 7, x + 29, y + 16), fill=PALETTE["shadow"])
    draw.line((x - 13, y - 5, x + 24, y + 4), fill=PALETTE["outline"], width=14)
    draw.line((x - 13, y - 5, x + 24, y + 4), fill=PALETTE["robe"], width=10)
    draw.ellipse((x - 29, y - 13, x - 9, y + 7), fill=PALETTE["outline"])
    draw.ellipse((x - 27, y - 11, x - 11, y + 5), fill=PALETTE["skin"])


def expand_poly(points: list[tuple[int, int]], amount: int) -> list[tuple[int, int]]:
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    expanded = []
    for px, py in points:
        expanded.append((round(px + math.copysign(amount, px - cx)), round(py + math.copysign(amount, py - cy))))
    return expanded


def preview_indices(frame_count: int) -> set[int]:
    return {0, max(0, frame_count // 2), frame_count - 1}


def save_preview_frames(frame_paths: list[Path], output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for index, frame_path in enumerate(frame_paths):
        animation = frame_path.parent.name
        output_path = output_dir / f"{index:02d}-{animation}-{frame_path.name}"
        Image.open(frame_path).save(output_path)


def save_preview_sheet(frame_paths: list[Path], output_path: Path) -> None:
    columns = 10
    padding = 8
    label_height = 13
    cell_width = FRAME_SIZE + padding
    cell_height = FRAME_SIZE + padding + label_height
    rows = math.ceil(len(frame_paths) / columns)
    sheet = Image.new("RGBA", (columns * cell_width + padding, rows * cell_height + padding), (8, 11, 15, 255))
    draw = ImageDraw.Draw(sheet)

    for index, frame_path in enumerate(frame_paths):
        frame = Image.open(frame_path).convert("RGBA")
        column = index % columns
        row = index // columns
        x = padding + column * cell_width
        y = padding + row * cell_height
        animation = frame_path.parent.name
        draw.rectangle((x, y, x + FRAME_SIZE - 1, y + FRAME_SIZE + label_height - 1), outline=(52, 64, 74, 255))
        draw.text((x + 3, y + 2), animation[:11], fill=(210, 226, 235, 255))
        sheet.alpha_composite(frame, (x, y + label_height))

    sheet.save(output_path)
    sheet.save(STAGE / "previews" / "water-platform-v1-contact-sheet.png")


def render_small_preview(frames: list[Image.Image], output_path: Path) -> None:
    sheet = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * FRAME_SIZE, 0))
    sheet.save(output_path)


def update_manifest() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["frameWidth"] = FRAME_SIZE
    manifest["frameHeight"] = FRAME_SIZE
    manifest["anchor"] = "bottom-center"
    for animation, info in {**WATER_ANIMATIONS, **{alias: WATER_ANIMATIONS[source] for alias, source in LEGACY_ALIASES.items()}}.items():
        manifest["animations"][animation] = info
        manifest["fighters"]["water"]["sheets"][animation] = f"/assets/sprites/fighters/water/{animation}.png"
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def sprite_prompts() -> str:
    return """# Water Platform Sprite V1 Prompts

Generated pixel pipeline target: Tide Warden, a side-facing water martial artist for a 2D platform fighter.

Seed requirements:
- transparent background
- 96x96 runtime frame after normalization
- bottom-center anchor
- same right-facing silhouette for every strip
- readable blue-gray robe, pale sash, dark hair, tan face and hands
- larger limbs and torso than the original placeholder stick figure
- water ribbons support the pose but do not define the body bounds

Strip requirements:
- generate one complete horizontal strip per animation
- preserve character identity, palette, scale, and facing
- no scenery, labels, shadows outside the sprite, or poster composition
- action must read at actual in-game scale
"""


if __name__ == "__main__":
    main()
