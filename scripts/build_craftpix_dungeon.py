from __future__ import annotations

import csv
import io
import json
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
# The canonical vendor pack is the same set consumed by the TMX catalog.  The
# older craftpix-dungeon copy is retained only as an imported legacy artifact.
SOURCE = ROOT / "assets-src" / "vendor" / "craftpix" / "dungeon-base" / "Tiled_files"
OUTPUT = ROOT / "public" / "assets" / "dungeons"
PREVIEW = ROOT / "public" / "assets" / "preview"
ENTRY = (14, 24)
STAIRS = (20, 4)

BASE_LAYERS = {
    "water_floor3",
    "water_detailization2",
    "water_detailization",
    "Floor2_pool",
    "Floor2_darker_surface",
    "Floor",
    "Floor_darker_surface",
}
FOREGROUND_LAYERS = {
    "walls_under_water",
    "Walls",
    "Windows",
    "Objects_under_wall",
    "Lights",
}
DRY_FLOOR_LAYERS = {
    "Floor2_pool",
    "Floor2_darker_surface",
    "Floor",
    "Floor_darker_surface",
}
DOORS_FIRST_GID = 5429
DOORS_LAST_GID = 5578

CATALOG_ASSETS = {
    "decorative_cracks_walls.png": ("craftpix/decorative_cracks_walls.png", "cracks-wall"),
    "decorative_cracks_floor.png": ("craftpix/decorative_cracks_floor.png", "cracks-floor"),
    "walls_floor.png": ("craftpix/walls_floor.png", "walls-floor"),
    "Water_coasts_animation.png": ("craftpix/Water_coasts_animation.png", "water-coasts"),
    "water_details_animation.png": ("craftpix/water_details_animation.png", "water-details"),
    "decorative_cracks_coasts_animation.png": ("craftpix/decorative_cracks_coasts_animation.png", "cracks-coasts"),
    "fire_animation.png": ("craftpix/fire_animation.png", "fire"),
    "fire_animation2.png": ("craftpix/fire_animation2.png", "fire-alt"),
    "doors_lever_chest_animation.png": ("craftpix/doors_lever_chest_animation.png", "doors"),
    "Objects.png": ("craftpix/Objects.png", "objects"),
    "trap_animation.png": ("craftpix/trap_animation.png", "traps"),
}

MANUAL_LAYER_SOURCES = {
    "ground": BASE_LAYERS,
    "structure": {"walls_under_water"},
    "decoration": {"traps", "Objects", "Objects2"},
    "overhead": {"Objects_under_wall", "Walls", "Windows"},
    "light": {"Lights"},
}

MANUAL_WIDTH = 48
MANUAL_HEIGHT = 36
MANUAL_OFFSET = ((MANUAL_WIDTH - 38) // 2, (MANUAL_HEIGHT - 28) // 2)


def write_runtime_assets() -> None:
    """Copy only source sheets referenced by the runtime catalog.

    The generated maps never infer rules from these pixels: this makes the
    asset boundary explicit while keeping the vendor originals untouched.
    """
    sheets = {}
    for source_name, (relative_output, sheet_id) in CATALOG_ASSETS.items():
        destination = OUTPUT / relative_output
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE / source_name, destination)
        image = Image.open(SOURCE / source_name)
        columns = image.width // 16
        sheets[sheet_id] = {"path": f"assets/dungeons/{relative_output}", "columns": columns, "frames": (image.width // 16) * (image.height // 16)}
    catalog = {
        "version": 1,
        "tile": 16,
        "sheets": sheets,
        "roles": {
            "floor": {"sheet": "walls-floor", "frame": 138},
            "floor-alt": {"sheet": "walls-floor", "frame": 139},
            "wall-center": {"sheet": "walls-floor", "frame": 36},
            "wall-north": {"sheet": "walls-floor", "frame": 19},
            "wall-east": {"sheet": "walls-floor", "frame": 26},
            "wall-south": {"sheet": "walls-floor", "frame": 53},
            "wall-west": {"sheet": "walls-floor", "frame": 70},
            "wall-corner": {"sheet": "walls-floor", "frame": 64},
            "wall-inner": {"sheet": "walls-floor", "frame": 87},
            "stairs-up": {"sheet": "walls-floor", "frame": 324},
            "stairs-down": {"sheet": "walls-floor", "frame": 326},
            "torch": {"sheet": "objects", "frame": 174},
            "tomb": {"sheet": "objects", "frame": 198},
            "chest": {"sheet": "doors", "frame": 18},
            "crack": {"sheet": "cracks", "frame": 0},
        },
    }
    (OUTPUT / "craftpix-tile-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_animation_catalog() -> None:
    """Export Tiled's authoritative animation frames for every animated sheet."""
    root = ET.parse(SOURCE / "Dungeon1.tmx").getroot()
    by_filename = {name: sheet_id for name, (_, sheet_id) in CATALOG_ASSETS.items()}
    clips: list[dict[str, object]] = []
    for tileset in root.findall("tileset"):
        image = tileset.find("image")
        sheet_id = by_filename.get(image.attrib.get("source", "")) if image is not None else None
        if not sheet_id:
            continue
        for tile in tileset.findall("tile"):
            animation = tile.find("animation")
            if animation is None:
                continue
            frames = [
                {"frame": int(frame.attrib["tileid"]), "duration": int(frame.attrib.get("duration", "150"))}
                for frame in animation.findall("frame")
            ]
            if not frames:
                continue
            clips.append({
                "id": f"{sheet_id}:{tile.attrib['id']}",
                "sheet": sheet_id,
                "representative": frames[0]["frame"],
                "frames": frames,
                "loop": True,
            })
    payload = {"version": 1, "tile": 16, "clips": clips}
    (OUTPUT / "craftpix-animation-catalog.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def tile_sources() -> list[tuple[int, int, str]]:
    root = ET.parse(SOURCE / "Dungeon1.tmx").getroot()
    sources: list[tuple[int, int, str]] = []
    by_filename = {name: sheet_id for name, (_, sheet_id) in CATALOG_ASSETS.items()}
    for tileset in root.findall("tileset"):
        image = tileset.find("image")
        if image is None or "source" not in image.attrib:
            continue
        sheet_id = by_filename.get(image.attrib["source"])
        if sheet_id:
            sources.append((int(tileset.attrib["firstgid"]), int(tileset.attrib["columns"]), sheet_id))
    return sources


def tile_animation_lookup() -> dict[int, str]:
    root = ET.parse(SOURCE / "Dungeon1.tmx").getroot()
    by_filename = {name: sheet_id for name, (_, sheet_id) in CATALOG_ASSETS.items()}
    lookup: dict[int, str] = {}
    for tileset in root.findall("tileset"):
        image = tileset.find("image")
        sheet_id = by_filename.get(image.attrib.get("source", "")) if image is not None else None
        if not sheet_id:
            continue
        first_gid = int(tileset.attrib["firstgid"])
        for tile in tileset.findall("tile"):
            if tile.find("animation") is not None:
                lookup[first_gid + int(tile.attrib["id"])] = f"{sheet_id}:{tile.attrib['id']}"
    return lookup


def write_manual_sample(
    layers: dict[str, dict[tuple[int, int], int]],
    min_x: int,
    min_y: int,
    collision: list[str],
) -> None:
    source_tiles = tile_sources()
    animation_lookup = tile_animation_lookup()
    visual_layers: dict[str, list[dict[str, object]]] = {name: [] for name in MANUAL_LAYER_SOURCES}
    for target_layer, source_layer_names in MANUAL_LAYER_SOURCES.items():
        for source_layer_name, entries in layers.items():
            if source_layer_name not in source_layer_names:
                continue
            for (x, y), raw in entries.items():
                gid, flip_x, flip_y, diagonal = decode_tile(raw)
                first_gid, columns, sheet_id = max((source for source in source_tiles if source[0] <= gid), key=lambda source: source[0])
                placement: dict[str, object] = {
                    "x": x - min_x + MANUAL_OFFSET[0],
                    "y": y - min_y + MANUAL_OFFSET[1],
                    "sheet": sheet_id,
                    "frame": gid - first_gid,
                }
                if gid in animation_lookup:
                    placement["animationId"] = animation_lookup[gid]
                if flip_x:
                    placement["flipX"] = True
                if flip_y:
                    placement["flipY"] = True
                if diagonal:
                    placement["rotation"] = 90
                visual_layers[target_layer].append(placement)

    manual_collision = [1] * (MANUAL_WIDTH * MANUAL_HEIGHT)
    for y, row in enumerate(collision):
        for x, value in enumerate(row):
            manual_collision[(y + MANUAL_OFFSET[1]) * MANUAL_WIDTH + x + MANUAL_OFFSET[0]] = 0 if value == "." else 1
    payload = {
        "version": 1,
        "id": "legacy-showcase",
        "name": "旧固定マップ（編集見本）",
        "width": MANUAL_WIDTH,
        "height": MANUAL_HEIGHT,
        "tileSize": 16,
        "layers": visual_layers,
        "collision": manual_collision,
        "collisionLocked": [False] * (MANUAL_WIDTH * MANUAL_HEIGHT),
        "hardEdges": [],
        "entrance": {"x": ENTRY[0] + MANUAL_OFFSET[0], "y": ENTRY[1] + MANUAL_OFFSET[1]},
        "stairs": {"x": STAIRS[0] + MANUAL_OFFSET[0], "y": STAIRS[1] + MANUAL_OFFSET[1]},
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "legacyReference": True,
    }
    (OUTPUT / "manual-showcase-v1.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def decode_tile(raw: int) -> tuple[int, bool, bool, bool]:
    gid = raw & 0x1FFFFFFF
    return gid, bool(raw & 0x80000000), bool(raw & 0x40000000), bool(raw & 0x20000000)


def read_map() -> tuple[int, int, int, int, int, int, dict[str, dict[tuple[int, int], int]], list[tuple[int, int, Image.Image, int]]]:
    root = ET.parse(SOURCE / "Dungeon1.tmx").getroot()
    tile_width = int(root.attrib["tilewidth"])
    tile_height = int(root.attrib["tileheight"])
    tilesets: list[tuple[int, int, Image.Image, int]] = []
    for tileset in root.findall("tileset"):
        first_gid = int(tileset.attrib["firstgid"])
        columns = int(tileset.attrib["columns"])
        image = tileset.find("image")
        if image is None or "source" not in image.attrib:
            continue
        sheet = Image.open(SOURCE / image.attrib["source"]).convert("RGBA")
        tilesets.append((first_gid, columns, sheet, tile_width))
    layers: dict[str, dict[tuple[int, int], int]] = defaultdict(dict)
    for layer in root.findall("layer"):
        data = layer.find("data")
        if data is None:
            continue
        for chunk in data.findall("chunk"):
            chunk_x = int(chunk.attrib["x"])
            chunk_y = int(chunk.attrib["y"])
            chunk_width = int(chunk.attrib["width"])
            values = [int(value) for row in csv.reader(io.StringIO((chunk.text or "").strip())) for value in row if value.strip()]
            for index, raw in enumerate(values):
                gid, _, _, _ = decode_tile(raw)
                if gid:
                    layers[layer.attrib["name"]][(chunk_x + index % chunk_width, chunk_y + index // chunk_width)] = raw
    positions = [position for layer in layers.values() for position in layer]
    min_x = min(x for x, _ in positions)
    max_x = max(x for x, _ in positions)
    min_y = min(y for _, y in positions)
    max_y = max(y for _, y in positions)
    return tile_width, tile_height, min_x, max_x, min_y, max_y, layers, tilesets


def tile_image(raw: int, tilesets: list[tuple[int, int, Image.Image, int]], tile_size: int) -> Image.Image:
    gid, flip_x, flip_y, diagonal = decode_tile(raw)
    first_gid, columns, sheet, _ = max((tileset for tileset in tilesets if tileset[0] <= gid), key=lambda tileset: tileset[0])
    local_id = gid - first_gid
    tile = sheet.crop(((local_id % columns) * tile_size, (local_id // columns) * tile_size, (local_id % columns + 1) * tile_size, (local_id // columns + 1) * tile_size))
    if diagonal:
        tile = tile.transpose(Image.Transpose.TRANSPOSE)
    if flip_x:
        tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if flip_y:
        tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return tile


def render_group(
    group: set[str],
    layers: dict[str, dict[tuple[int, int], int]],
    tilesets: list[tuple[int, int, Image.Image, int]],
    min_x: int,
    min_y: int,
    width: int,
    height: int,
    tile_size: int,
) -> Image.Image:
    output = Image.new("RGBA", (width * tile_size, height * tile_size), (0, 0, 0, 0))
    for layer_name, entries in layers.items():
        if layer_name not in group:
            continue
        for (x, y), raw in entries.items():
            tile = tile_image(raw, tilesets, tile_size)
            output.alpha_composite(tile, ((x - min_x) * tile_size, (y - min_y) * tile_size))
    return output


def build_collision(layers: dict[str, dict[tuple[int, int], int]], min_x: int, min_y: int, width: int, height: int) -> list[str]:
    dry_floor: set[tuple[int, int]] = set()
    for layer_name in DRY_FLOOR_LAYERS:
        dry_floor.update(layers.get(layer_name, {}))
    walls = set(layers.get("Walls", {}))
    doors: set[tuple[int, int]] = set()
    for entries in layers.values():
        for position, raw in entries.items():
            gid, _, _, _ = decode_tile(raw)
            if DOORS_FIRST_GID <= gid <= DOORS_LAST_GID:
                doors.add(position)
    walkable = (dry_floor - walls) | doors
    mask = [[False for _ in range(width)] for _ in range(height)]
    for x, y in walkable:
        nx, ny = x - min_x, y - min_y
        if 0 <= nx < width and 0 <= ny < height:
            mask[ny][nx] = True

    entry = ENTRY
    stairs = STAIRS
    if not mask[entry[1]][entry[0]] or not mask[stairs[1]][stairs[0]]:
        raise RuntimeError("Craftpix fixed entry/stairs must be walkable")
    queue = deque([entry])
    reached = {entry}
    while queue:
        x, y = queue.popleft()
        for next_position in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            nx, ny = next_position
            if 0 <= nx < width and 0 <= ny < height and mask[ny][nx] and next_position not in reached:
                reached.add(next_position)
                queue.append(next_position)
    if stairs not in reached:
        raise RuntimeError("Craftpix fixed entry and stairs are disconnected")
    for y in range(height):
        for x in range(width):
            if mask[y][x] and (x, y) not in reached:
                mask[y][x] = False
    return ["".join("." if mask[y][x] else "#" for x in range(width)) for y in range(height)]


def write_collision_preview(base: Image.Image, foreground: Image.Image, collision: list[str]) -> None:
    image = Image.alpha_composite(base, foreground)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    tile_size = 16
    for y, row in enumerate(collision):
        for x, cell in enumerate(row):
            color = (48, 190, 100, 55) if cell == "." else (210, 50, 50, 80)
            draw.rectangle((x * tile_size, y * tile_size, (x + 1) * tile_size - 1, (y + 1) * tile_size - 1), fill=color)
    draw.rectangle((ENTRY[0] * tile_size, ENTRY[1] * tile_size, (ENTRY[0] + 1) * tile_size - 1, (ENTRY[1] + 1) * tile_size - 1), outline=(255, 255, 255, 255), width=2)
    draw.rectangle((STAIRS[0] * tile_size, STAIRS[1] * tile_size, (STAIRS[0] + 1) * tile_size - 1, (STAIRS[1] + 1) * tile_size - 1), outline=(255, 220, 70, 255), width=2)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(image, overlay).save(PREVIEW / "craftpix-dungeon-collision.png")


def main() -> None:
    tile_width, tile_height, min_x, max_x, min_y, max_y, layers, tilesets = read_map()
    if tile_width != 16 or tile_height != 16:
        raise RuntimeError(f"Craftpix map must be 16x16, got {tile_width}x{tile_height}")
    width = max_x - min_x + 1
    height = max_y - min_y + 1
    base = render_group(BASE_LAYERS, layers, tilesets, min_x, min_y, width, height, tile_width)
    foreground = render_group(FOREGROUND_LAYERS, layers, tilesets, min_x, min_y, width, height, tile_width)
    collision = build_collision(layers, min_x, min_y, width, height)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_runtime_assets()
    write_animation_catalog()
    base.save(OUTPUT / "craftpix-showcase-base.png")
    foreground.save(OUTPUT / "craftpix-showcase-foreground.png")
    (OUTPUT / "craftpix-showcase.json").write_text(json.dumps({
        "tile": tile_width,
        "width": width,
        "height": height,
        "sourceBounds": {"x": min_x, "y": min_y},
        "base": "assets/dungeons/craftpix-showcase-base.png",
        "foreground": "assets/dungeons/craftpix-showcase-foreground.png",
        "entry": {"x": ENTRY[0], "y": ENTRY[1]},
        "stairs": {"x": STAIRS[0], "y": STAIRS[1]},
        "collision": collision,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_manual_sample(layers, min_x, min_y, collision)
    write_collision_preview(base, foreground, collision)
    print(f"generated {width}x{height} Craftpix dungeon at {OUTPUT}")


if __name__ == "__main__":
    main()
