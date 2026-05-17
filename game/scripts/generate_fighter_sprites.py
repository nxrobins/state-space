from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "sprites" / "fighters"
FRAME_SIZE = 96
GROUND_Y = 82
CENTER_X = 48


FIGHTERS: dict[str, dict[str, Any]] = {
    "water": {
        "body": (45, 108, 214, 255),
        "body_dark": (20, 55, 116, 255),
        "accent": (158, 231, 255, 255),
        "fx": (93, 211, 255, 210),
        "skin": (198, 144, 102, 255),
        "hair": (20, 24, 30, 255),
        "outline": (4, 12, 22, 255),
    },
    "earth": {
        "body": (176, 132, 77, 255),
        "body_dark": (93, 61, 39, 255),
        "accent": (226, 198, 111, 255),
        "fx": (163, 128, 82, 230),
        "skin": (184, 113, 74, 255),
        "hair": (30, 22, 18, 255),
        "outline": (18, 12, 10, 255),
    },
    "fire": {
        "body": (184, 45, 29, 255),
        "body_dark": (31, 24, 24, 255),
        "accent": (255, 209, 102, 255),
        "fx": (255, 112, 32, 230),
        "skin": (190, 118, 78, 255),
        "hair": (18, 15, 14, 255),
        "outline": (18, 8, 6, 255),
    },
}

ANIMATIONS: dict[str, dict[str, int | bool]] = {
    "idle": {"frames": 6, "fps": 2, "loop": True},
    "run": {"frames": 8, "fps": 14, "loop": True},
    "jump": {"frames": 4, "fps": 10, "loop": False},
    "block": {"frames": 4, "fps": 10, "loop": True},
    "hurt": {"frames": 4, "fps": 12, "loop": False},
    "basic": {"frames": 6, "fps": 16, "loop": False},
    "special1": {"frames": 8, "fps": 14, "loop": False},
    "special2": {"frames": 8, "fps": 14, "loop": False},
    "special3": {"frames": 8, "fps": 14, "loop": False},
    "ko": {"frames": 6, "fps": 8, "loop": False},
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "frameWidth": FRAME_SIZE,
        "frameHeight": FRAME_SIZE,
        "anchor": "bottom-center",
        "animations": ANIMATIONS,
        "fighters": {},
    }

    for fighter_id, palette in FIGHTERS.items():
        fighter_dir = OUT / fighter_id
        frames_root = fighter_dir / "frames"
        fighter_dir.mkdir(parents=True, exist_ok=True)
        frames_root.mkdir(parents=True, exist_ok=True)
        manifest["fighters"][fighter_id] = {"sheets": {}}

        preview_frames: list[Path] = []
        for animation_id, animation in ANIMATIONS.items():
            frame_count = int(animation["frames"])
            frames: list[Image.Image] = []
            anim_frame_dir = frames_root / animation_id
            anim_frame_dir.mkdir(parents=True, exist_ok=True)

            for frame_index in range(frame_count):
                frame = render_frame(fighter_id, palette, animation_id, frame_index, frame_count)
                frames.append(frame)
                frame_path = anim_frame_dir / f"frame-{frame_index + 1:02d}.png"
                frame.save(frame_path)
                if frame_index in preview_indices(frame_count):
                    preview_frames.append(frame_path)

            sheet = Image.new("RGBA", (FRAME_SIZE * frame_count, FRAME_SIZE), (0, 0, 0, 0))
            for frame_index, frame in enumerate(frames):
                sheet.alpha_composite(frame, (frame_index * FRAME_SIZE, 0))

            sheet_path = fighter_dir / f"{animation_id}.png"
            sheet.save(sheet_path)
            manifest["fighters"][fighter_id]["sheets"][animation_id] = f"/assets/sprites/fighters/{fighter_id}/{animation_id}.png"

        (fighter_dir / "preview-frame-list.json").write_text(
            json.dumps([str(path.relative_to(fighter_dir)).replace("\\", "/") for path in preview_frames], indent=2),
            encoding="utf-8",
        )
        save_preview_frames(preview_frames, fighter_dir / "preview-frames")
        save_preview_sheet(preview_frames, fighter_dir / "preview.png")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def preview_indices(frame_count: int) -> set[int]:
    return {0, max(0, frame_count // 2), frame_count - 1}


def save_preview_frames(frame_paths: list[Path], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for old_file in output_dir.glob("*.png"):
        old_file.unlink()

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


def render_frame(fighter_id: str, palette: dict[str, tuple[int, int, int, int]], animation: str, frame: int, total: int) -> Image.Image:
    image = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    t = frame / max(1, total - 1)
    wave = math.sin(t * math.tau)

    if animation == "ko" and frame > 1:
        draw_ko(draw, palette, t)
        return image

    pose = pose_for(animation, t, wave)
    draw_shadow(draw, pose)
    draw_body(draw, palette, pose)
    draw_element_fx(draw, fighter_id, palette, animation, t, pose)
    if animation == "hurt":
        draw_recoil_flash(draw, t)
    return image


def pose_for(animation: str, t: float, wave: float) -> dict[str, Any]:
    idle_bob = round(math.sin(t * math.tau) * 0.4) if animation == "idle" else round(wave * 1.6)
    pose: dict[str, Any] = {
        "x": CENTER_X,
        "y": GROUND_Y - 30,
        "bob": idle_bob,
        "lean": 0,
        "crouch": 0,
        "left_arm": (-12, 5, -21, 19),
        "right_arm": (12, 4, 25, 12),
        "left_leg": (-7, 25, -11, 45),
        "right_leg": (7, 25, 11, 45),
    }

    if animation == "run":
        stride = math.sin(t * math.tau)
        pose["bob"] = round(abs(stride) * -2)
        pose["lean"] = 4
        pose["left_arm"] = (-10, 6, -23, 8 + round(stride * 8))
        pose["right_arm"] = (12, 5, 28, 7 - round(stride * 8))
        pose["left_leg"] = (-6, 25, -18 + round(stride * 10), 45)
        pose["right_leg"] = (7, 25, 18 - round(stride * 10), 45)
    elif animation == "jump":
        pose["bob"] = -8 - round(math.sin(t * math.pi) * 7)
        pose["left_leg"] = (-7, 25, -15, 36)
        pose["right_leg"] = (7, 25, 14, 36)
        pose["left_arm"] = (-12, 4, -25, -4)
        pose["right_arm"] = (12, 4, 25, -4)
    elif animation == "block":
        pose["crouch"] = 3
        pose["left_arm"] = (-11, 5, 2, 11)
        pose["right_arm"] = (12, 5, 4, 19)
        pose["left_leg"] = (-7, 25, -17, 44)
        pose["right_leg"] = (7, 25, 14, 43)
    elif animation == "hurt":
        pose["lean"] = -7 - round(t * 4)
        pose["bob"] = -2
        pose["left_arm"] = (-12, 5, -23, 0)
        pose["right_arm"] = (12, 5, 18, 22)
    elif animation == "basic":
        thrust = math.sin(t * math.pi)
        pose["lean"] = round(6 * thrust)
        pose["right_arm"] = (12, 4, 24 + round(18 * thrust), 4 - round(7 * thrust))
        pose["left_arm"] = (-12, 5, -20, 16)
    elif animation.startswith("special"):
        charge = math.sin(t * math.pi)
        pose["bob"] = -round(charge * 3)
        pose["lean"] = round(3 * charge)
        pose["right_arm"] = (12, 3, 24 + round(12 * charge), -2 - round(10 * charge))
        pose["left_arm"] = (-12, 4, -25, 6 + round(10 * charge))

    return pose


def draw_shadow(draw: ImageDraw.ImageDraw, pose: dict[str, Any]) -> None:
    width = 28 if pose["bob"] > -7 else 22
    draw.ellipse((CENTER_X - width, GROUND_Y - 5, CENTER_X + width, GROUND_Y + 3), fill=(0, 0, 0, 78))


def draw_body(draw: ImageDraw.ImageDraw, palette: dict[str, tuple[int, int, int, int]], pose: dict[str, Any]) -> None:
    x = int(pose["x"])
    y = int(pose["y"] + pose["bob"] + pose["crouch"])
    lean = int(pose["lean"])
    outline = palette["outline"]
    skin = palette["skin"]
    body = palette["body"]
    dark = palette["body_dark"]
    accent = palette["accent"]

    # Legs behind torso.
    draw_limb(draw, x, y, pose["left_leg"], outline, dark, 7)
    draw_limb(draw, x, y, pose["right_leg"], outline, body, 7)

    torso = [
        (x - 13 + lean, y - 10),
        (x + 12 + lean, y - 10),
        (x + 16 + lean // 2, y + 25),
        (x - 14 + lean // 2, y + 25),
    ]
    draw.polygon(expand_poly(torso, 2), fill=outline)
    draw.polygon(torso, fill=body)
    draw.line((x - 9 + lean, y - 6, x + 11 + lean // 2, y + 21), fill=accent, width=3)
    draw.rectangle((x - 14 + lean // 2, y + 20, x + 16 + lean // 2, y + 25), fill=dark)

    # Arms over torso.
    draw_limb(draw, x, y, pose["left_arm"], outline, body, 6)
    draw_limb(draw, x, y, pose["right_arm"], outline, body, 6)
    draw_hand(draw, x + pose["left_arm"][2], y + pose["left_arm"][3], outline, skin)
    draw_hand(draw, x + pose["right_arm"][2], y + pose["right_arm"][3], outline, skin)

    # Head and hair.
    draw.ellipse((x - 10 + lean - 2, y - 30, x + 10 + lean + 2, y - 8), fill=outline)
    draw.ellipse((x - 9 + lean, y - 29, x + 9 + lean, y - 10), fill=skin)
    draw.polygon(
        [(x - 10 + lean, y - 24), (x + 10 + lean, y - 28), (x + 7 + lean, y - 15), (x - 8 + lean, y - 18)],
        fill=palette["hair"],
    )


def draw_limb(
    draw: ImageDraw.ImageDraw,
    base_x: int,
    base_y: int,
    limb: tuple[int, int, int, int],
    outline: tuple[int, int, int, int],
    color: tuple[int, int, int, int],
    width: int,
) -> None:
    x1, y1, x2, y2 = limb
    draw.line((base_x + x1, base_y + y1, base_x + x2, base_y + y2), fill=outline, width=width + 3)
    draw.line((base_x + x1, base_y + y1, base_x + x2, base_y + y2), fill=color, width=width)


def draw_hand(draw: ImageDraw.ImageDraw, x: int, y: int, outline: tuple[int, int, int, int], skin: tuple[int, int, int, int]) -> None:
    draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=outline)
    draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=skin)


def draw_element_fx(
    draw: ImageDraw.ImageDraw,
    fighter_id: str,
    palette: dict[str, tuple[int, int, int, int]],
    animation: str,
    t: float,
    pose: dict[str, Any],
) -> None:
    if animation not in {"block", "basic", "special1", "special2", "special3"}:
        return

    fx = palette["fx"]
    accent = palette["accent"]
    x = CENTER_X + int(pose["lean"])
    y = int(pose["y"] + pose["bob"] + pose["crouch"])
    pulse = math.sin(t * math.tau)

    if fighter_id == "water":
        if animation == "block":
            draw.arc((x - 26, y - 32, x + 28, y + 28), 210, 70, fill=accent, width=3)
        elif animation.startswith("special"):
            radius = 18 + int(t * 16)
            draw.arc((x + 6, y - 24, x + 6 + radius * 2, y - 24 + radius * 2), 210, 340, fill=fx, width=4)
            draw.arc((x - 38, y - 8, x + 42, y + 38), 15, 160, fill=fx, width=3)
        else:
            draw.arc((x - 22, y - 24, x + 24, y + 20), 25, 150 + int(pulse * 12), fill=fx, width=2)
    elif fighter_id == "earth":
        rocks = [(-28, 8), (25, -4), (20, 22)] if animation.startswith("special") else [(-22, 14), (24, 12)]
        for i, (rx, ry) in enumerate(rocks):
            size = 4 + (i % 2) + (2 if animation.startswith("special") else 0)
            ox = int(math.sin(t * math.tau + i) * 3)
            oy = int(math.cos(t * math.tau + i) * 2)
            draw.polygon(
                [(x + rx + ox, y + ry - size + oy), (x + rx + size + ox, y + ry + oy), (x + rx + ox, y + ry + size + oy), (x + rx - size + ox, y + ry + oy)],
                fill=palette["outline"],
            )
            draw.polygon(
                [(x + rx + ox, y + ry - size + 1 + oy), (x + rx + size - 1 + ox, y + ry + oy), (x + rx + ox, y + ry + size - 1 + oy), (x + rx - size + 1 + ox, y + ry + oy)],
                fill=fx,
            )
        if animation == "block":
            draw.rectangle((x + 12, y - 22, x + 22, y + 18), fill=palette["outline"])
            draw.rectangle((x + 13, y - 21, x + 21, y + 17), fill=fx)
    elif fighter_id == "fire":
        if animation == "block":
            draw.arc((x - 24, y - 31, x + 28, y + 25), 235, 80, fill=fx, width=3)
        else:
            for i in range(3 if animation.startswith("special") else 1):
                flame_x = x + 22 + i * 8
                flame_y = y - 6 - i * 5 - int(abs(pulse) * 3)
                draw.polygon(
                    [(flame_x, flame_y - 13), (flame_x + 8, flame_y + 2), (flame_x, flame_y + 9), (flame_x - 7, flame_y + 1)],
                    fill=fx,
                )
                draw.polygon(
                    [(flame_x, flame_y - 7), (flame_x + 4, flame_y + 2), (flame_x, flame_y + 5), (flame_x - 3, flame_y + 1)],
                    fill=accent,
                )


def draw_recoil_flash(draw: ImageDraw.ImageDraw, t: float) -> None:
    alpha = int(130 * (1 - t))
    draw.line((26, 25, 14, 16), fill=(255, 80, 66, alpha), width=3)
    draw.line((30, 42, 14, 42), fill=(255, 80, 66, alpha), width=3)


def draw_ko(draw: ImageDraw.ImageDraw, palette: dict[str, tuple[int, int, int, int]], t: float) -> None:
    outline = palette["outline"]
    body = palette["body"]
    dark = palette["body_dark"]
    skin = palette["skin"]
    y = GROUND_Y - 8 + int(min(1, t) * 3)
    x = CENTER_X - 2
    draw.ellipse((x - 30, GROUND_Y - 4, x + 28, GROUND_Y + 3), fill=(0, 0, 0, 82))
    draw.line((x - 24, y - 8, x + 18, y - 8), fill=outline, width=17)
    draw.line((x - 24, y - 8, x + 18, y - 8), fill=body, width=13)
    draw.line((x - 8, y - 2, x + 22, y + 7), fill=outline, width=8)
    draw.line((x - 8, y - 2, x + 22, y + 7), fill=dark, width=5)
    draw.ellipse((x - 38, y - 18, x - 19, y + 1), fill=outline)
    draw.ellipse((x - 36, y - 16, x - 21, y - 1), fill=skin)


def expand_poly(points: list[tuple[int, int]], amount: int) -> list[tuple[int, int]]:
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    expanded: list[tuple[int, int]] = []
    for x, y in points:
        expanded.append((round(x + math.copysign(amount, x - cx)), round(y + math.copysign(amount, y - cy))))
    return expanded


if __name__ == "__main__":
    main()
