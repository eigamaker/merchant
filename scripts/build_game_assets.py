"""Build the runtime pixel-art sheets from project-bound generated source packs.

The source images deliberately have generous chroma-key gutters.  This script
turns their isolated art into the 24px tile and 32px actor contracts used by
Phaser.  It is deterministic and can be re-run whenever a source pack is
replaced.
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-src"
PUBLIC = ROOT / "public" / "assets"
TILE = 24
ACTOR = 32


def output(path: str) -> Path:
    target = PUBLIC / path
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def rgba(path: str) -> Image.Image:
    return Image.open(SOURCE / path).convert("RGBA")


def alpha_box(image: Image.Image) -> tuple[int, int, int, int] | None:
    return image.getchannel("A").getbbox()


def trim(image: Image.Image, padding: int = 0) -> Image.Image:
    bbox = alpha_box(image)
    if bbox is None:
        return Image.new("RGBA", (1, 1))
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(image.width, bbox[2] + padding)
    bottom = min(image.height, bbox[3] + padding)
    return image.crop((left, top, right, bottom))


def grid_item(image: Image.Image, columns: int, rows: int, index: int, inset: int = 0) -> Image.Image:
    """Return one grid cell, tightened to the non-keyed art inside it."""
    column = index % columns
    row = index // columns
    left = round(column * image.width / columns)
    right = round((column + 1) * image.width / columns)
    top = round(row * image.height / rows)
    bottom = round((row + 1) * image.height / rows)
    cell = image.crop((left + inset, top + inset, right - inset, bottom - inset))
    return trim(cell, 1)


def actor_grid_item(image: Image.Image, columns: int, rows: int, index: int) -> Image.Image:
    """Crop actor art while ignoring chroma-key residue on cell borders.

    Generated direction atlases can retain a one-pixel alpha fringe at the
    outer edge. Including it in the bounding box makes equal-sized front/back
    poses shrink while side poses fill the actor frame.
    """
    return grid_item(image, columns, rows, index, inset=2)


def contain(image: Image.Image, width: int, height: int, anchor: str = "center") -> Image.Image:
    """Nearest-neighbour fit with transparent padding."""
    image = trim(image)
    if image.width == 0 or image.height == 0:
        return Image.new("RGBA", (width, height))
    ratio = min(width / image.width, height / image.height)
    sized = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.Resampling.NEAREST)
    result = Image.new("RGBA", (width, height))
    x = (width - sized.width) // 2
    y = height - sized.height if anchor == "bottom" else (height - sized.height) // 2
    result.alpha_composite(sized, (x, y))
    return result


def tile_sheet(columns: int = 16, rows: int = 8) -> Image.Image:
    return Image.new("RGBA", (columns * TILE, rows * TILE))


def paste_tile(sheet: Image.Image, frame: int, image: Image.Image) -> None:
    x = (frame % (sheet.width // TILE)) * TILE
    y = (frame // (sheet.width // TILE)) * TILE
    sheet.alpha_composite(image.convert("RGBA"), (x, y))


def animated_sheet(directional_images: list[Image.Image]) -> Image.Image:
    """Build down/left/right/up rows from true direction-specific source art."""
    if len(directional_images) != 4:
        raise ValueError("actor source must provide down, left, right and up images")
    sheet = Image.new("RGBA", (ACTOR * 4, ACTOR * 4))
    directions = [contain(image, ACTOR, ACTOR - 1, anchor="bottom") for image in directional_images]
    for row, posed in enumerate(directions):
        for column in range(4):
            frame = Image.new("RGBA", (ACTOR, ACTOR))
            shift_x = (-1, 0, 1, 0)[column]
            shift_y = (0, 1, 0, 1)[column]
            frame.alpha_composite(posed, (shift_x, shift_y))
            sheet.alpha_composite(frame, (column * ACTOR, row * ACTOR))
    return sheet


def build_actors() -> None:
    player_source = rgba("player-directions-alpha.png")
    animated_sheet([actor_grid_item(player_source, 4, 1, direction) for direction in range(4)]).save(output("actors/player.png"))

    npc_source = rgba("npc-directions-alpha.png")
    npc_names = ["npc-innkeeper", "npc-scout", "npc-scholar", "npc-mage", "npc-trader"]
    for column, name in enumerate(npc_names):
        directions = [actor_grid_item(npc_source, 5, 4, row * 5 + column) for row in range(4)]
        animated_sheet(directions).save(output(f"actors/{name}.png"))
    # Keep the manifest's single NPC entry usable while the scene picks variants.
    animated_sheet([actor_grid_item(npc_source, 5, 4, row * 5) for row in range(4)]).save(output("actors/npc.png"))

    enemy_source = rgba("enemy-directions-alpha.png")
    enemy_names = ["enemy-goblin", "enemy-bat", "enemy-golem", "enemy-necromancer", "enemy-lizard", "enemy-ghost"]
    for column, name in enumerate(enemy_names):
        directions = [actor_grid_item(enemy_source, 6, 4, row * 6 + column) for row in range(4)]
        animated_sheet(directions).save(output(f"actors/{name}.png"))
    animated_sheet([actor_grid_item(enemy_source, 6, 4, row * 6) for row in range(4)]).save(output("actors/enemy.png"))

    for guard_name in ("rolf", "mina"):
        guard_source = rgba(f"guard-{guard_name}-directions-alpha.png")
        directions = [actor_grid_item(guard_source, 4, 1, direction) for direction in range(4)]
        animated_sheet(directions).save(output(f"actors/guard-{guard_name}.png"))


def build_objects() -> None:
    props = rgba("town-props-alpha.png")
    town = tile_sheet()
    # Frames 0-11 are direct art; remaining frames intentionally repeat small
    # variations so callers can use a simple numeric frame id without blanks.
    for frame in range(128):
        prop = grid_item(props, 4, 3, frame % 12)
        size = TILE if frame % 3 else TILE - 2
        art = contain(prop, size, size, anchor="bottom")
        tile = Image.new("RGBA", (TILE, TILE))
        tile.alpha_composite(art, ((TILE - size) // 2, TILE - size))
        paste_tile(town, frame, tile)
    town.save(output("tiles/town_objects.png"))

    dungeon = rgba("dungeon-environment-alpha.png")
    object_sheet = Image.new("RGBA", (TILE * 8, TILE * 4))
    indexes = [7, 8, 9, 10, 11, 6, 5, 4]
    for frame in range(32):
        art = contain(grid_item(dungeon, 4, 3, indexes[frame % len(indexes)]), TILE - 2, TILE - 2, anchor="bottom")
        object_sheet.alpha_composite(art, ((frame % 8) * TILE + 1, (frame // 8) * TILE + 2))
    object_sheet.save(output("objects/items.png"))
    object_sheet.save(output("objects/dungeon_objects.png"))


def building_from_grid(
    source: Image.Image,
    index: int,
    width: int,
    *,
    mirror: bool = False,
    saturation: float = 1.0,
) -> Image.Image:
    """Fit one generated building into its runtime module without gutters."""
    art = grid_item(source, 3, 2, index)
    if mirror:
        art = art.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if saturation != 1.0:
        art = ImageEnhance.Color(art).enhance(saturation)
    # The source atlas has square presentation cells, while the runtime
    # contract has deliberately wide 4x3 and 8x3 building footprints.
    # Preserve every pixel-art edge with nearest-neighbour scaling, but fill
    # the complete collision and rendering footprint rather than centering a
    # small building in a transparent 8-cell canvas.
    return trim(art).resize((width, TILE * 3), Image.Resampling.NEAREST)


def wide_from_grid(source: Image.Image, index: int, width: int) -> Image.Image:
    """Compatibility wrapper for standalone full-building PNGs."""
    return building_from_grid(source, index, width)


def build_preview() -> None:
    # A compact contact sheet is useful for art review without exposing source
    # chrome-key backgrounds in the game.
    entries = [
        Image.open(output_path).convert("RGBA")
        for output_path in [
            output("actors/player.png"), output("actors/npc-innkeeper.png"), output("actors/enemy-goblin.png"),
            output("objects/items.png"), output("objects/dungeon_objects.png"),
        ]
    ]
    sheet = Image.new("RGBA", (384, 192), (33, 29, 38, 255))
    for index, entry in enumerate(entries):
        preview = contain(entry, 90, 70)
        x = 6 + (index % 4) * 95
        y = 10 + (index // 4) * 88
        sheet.alpha_composite(preview, (x, y))
    sheet.save(output("preview/full-asset-atlas.png"))


def main() -> None:
    build_actors()
    build_objects()
    build_preview()


if __name__ == "__main__":
    main()
