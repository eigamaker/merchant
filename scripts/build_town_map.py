"""Cut the supplied town illustration into the runtime 24px town map.

The source art is a single 1448x1086 overhead painting.  Cropping four pixels
horizontally and three vertically lands on 1440x1080, which is exactly 60x45
cells of the 24px town grid, so the picture reaches the game without a single
resample.  Phaser slices the result back into 2700 tiles at load time.

The script also renders two review images: a coordinate grid used to read
building rectangles off the art, and a collision overlay that shows what
``src/game/townLayout.json`` currently blocks.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-src" / "town-map-source.png"
LAYOUT = ROOT / "src" / "game" / "townLayout.json"
TILES = ROOT / "public" / "assets" / "tiles"
PREVIEW = ROOT / "public" / "assets" / "preview"

TILE = 24
WIDTH = 60
HEIGHT = 45
CROP = (4, 3, 1444, 1083)

# The painting holds 661k distinct colours because it is a smoothly shaded
# render rather than true pixel art.  Flattening it to a 256 entry palette
# without dithering cuts the runtime PNG from 3.7MB to 1.2MB and firms up the
# tile edges.  Set this to None to ship the untouched RGBA crop instead.
QUANTIZE_COLORS = 256


def load_map_image() -> Image.Image:
    image = Image.open(SOURCE).convert("RGB").crop(CROP)
    if image.size != (WIDTH * TILE, HEIGHT * TILE):
        raise ValueError(f"cropped map must be {WIDTH * TILE}x{HEIGHT * TILE}: got {image.size}")
    return image


def build_runtime_map(image: Image.Image) -> None:
    TILES.mkdir(parents=True, exist_ok=True)
    target = TILES / "town_map.png"
    if QUANTIZE_COLORS is None:
        image.convert("RGBA").save(target, "PNG", optimize=True)
    else:
        image.quantize(colors=QUANTIZE_COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
            target, "PNG", optimize=True
        )
    print(f"{target.relative_to(ROOT)} {image.width}x{image.height} ({target.stat().st_size // 1024} KB)")


def build_grid_preview(image: Image.Image) -> None:
    """Overlay the tile grid so collision rectangles can be read off the art."""
    preview = image.convert("RGBA")
    draw = ImageDraw.Draw(preview, "RGBA")
    for x in range(WIDTH + 1):
        strong = x % 5 == 0
        draw.line([(x * TILE, 0), (x * TILE, preview.height)], fill=(0, 0, 0, 150 if strong else 55), width=1)
    for y in range(HEIGHT + 1):
        strong = y % 5 == 0
        draw.line([(0, y * TILE), (preview.width, y * TILE)], fill=(0, 0, 0, 150 if strong else 55), width=1)
    for x in range(0, WIDTH, 5):
        for y in range(0, HEIGHT, 5):
            label = f"{x},{y}"
            draw.rectangle([x * TILE + 1, y * TILE + 1, x * TILE + 7 * len(label), y * TILE + 12], fill=(0, 0, 0, 170))
            draw.text((x * TILE + 2, y * TILE + 1), label, fill=(255, 240, 190, 255))
    target = PREVIEW / "town-map-grid.png"
    PREVIEW.mkdir(parents=True, exist_ok=True)
    preview.save(target, "PNG", optimize=True)
    print(f"{target.relative_to(ROOT)}")


def collision_grid(layout: dict) -> list[list[bool]]:
    """Read the layout mask exactly the way townMap.ts does: '#' blocks."""
    rows = layout["collision"]
    if len(rows) != HEIGHT or any(len(row) != WIDTH for row in rows):
        raise ValueError(f"collision mask must be {WIDTH}x{HEIGHT} characters")
    return [[char == "#" for char in row] for row in rows]


def build_collision_preview(image: Image.Image) -> None:
    layout = json.loads(LAYOUT.read_text(encoding="utf-8"))
    blocked = collision_grid(layout)
    preview = image.convert("RGBA")
    overlay = Image.new("RGBA", preview.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    for y in range(HEIGHT):
        for x in range(WIDTH):
            fill = (208, 40, 40, 110) if blocked[y][x] else (60, 210, 90, 70)
            draw.rectangle([x * TILE, y * TILE, x * TILE + TILE - 1, y * TILE + TILE - 1], fill=fill)
    for building in layout["buildings"]:
        left = building["x"] * TILE
        top = building["y"] * TILE
        draw.rectangle(
            [left, top, left + building["width"] * TILE - 1, top + building["height"] * TILE - 1],
            outline=(255, 235, 140, 255),
            width=2,
        )
        entrance = building["entrance"]
        draw.rectangle(
            [entrance["x"] * TILE, entrance["y"] * TILE, entrance["x"] * TILE + TILE - 1, entrance["y"] * TILE + TILE - 1],
            outline=(80, 190, 255, 255),
            width=3,
        )
    for point in layout["points"]:
        draw.ellipse(
            [point["x"] * TILE + 4, point["y"] * TILE + 4, point["x"] * TILE + TILE - 4, point["y"] * TILE + TILE - 4],
            outline=(255, 120, 220, 255),
            width=3,
        )
    spawn = layout["spawn"]
    draw.ellipse(
        [spawn["x"] * TILE + 2, spawn["y"] * TILE + 2, spawn["x"] * TILE + TILE - 2, spawn["y"] * TILE + TILE - 2],
        outline=(255, 255, 255, 255),
        width=3,
    )
    preview.alpha_composite(overlay)
    target = PREVIEW / "town-map-collision.png"
    PREVIEW.mkdir(parents=True, exist_ok=True)
    preview.save(target, "PNG", optimize=True)
    walkable = sum(row.count(False) for row in blocked)
    print(f"{target.relative_to(ROOT)} walkable={walkable}/{WIDTH * HEIGHT}")


def main() -> None:
    image = load_map_image()
    build_runtime_map(image)
    build_grid_preview(image)
    if LAYOUT.exists():
        build_collision_preview(image)
    else:
        print(f"{LAYOUT.relative_to(ROOT)} not found; skipped the collision overlay")


if __name__ == "__main__":
    main()
