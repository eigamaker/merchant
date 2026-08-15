"""Normalize the supplied merchant sprite sheet for the game's 16px grid.

The supplied image is a transparent 3-column by 4-row sheet with 32x32 cells.
The runtime keeps those authored cells at native size: one character frame is
two 16px map tiles, with no resampling or invented frames.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-src" / "player" / "merchant-protagonist-source.png"
OUTPUTS = (
    ROOT / "public" / "assets" / "actors" / "craftpix" / "MerchantProtagonist" / "MerchantProtagonist_Idle_with_shadow.png",
    ROOT / "public" / "assets" / "actors" / "craftpix" / "MerchantProtagonist" / "MerchantProtagonist_Walk_with_shadow.png",
    ROOT / "Unity" / "Assets" / "Resources" / "Merchan" / "assets" / "actors" / "craftpix" / "MerchantProtagonist" / "MerchantProtagonist_Idle_with_shadow.png",
    ROOT / "Unity" / "Assets" / "Resources" / "Merchan" / "assets" / "actors" / "craftpix" / "MerchantProtagonist" / "MerchantProtagonist_Walk_with_shadow.png",
)


def remove_border_background(cell: Image.Image) -> Image.Image:
    """Make near-white pixels transparent only when connected to the border."""

    rgba = cell.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    background = {
        (x, y)
        for y in range(height)
        for x in range(width)
        if pixels[x, y][3] == 0 or min(pixels[x, y][:3]) >= 245
    }
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))

    seen: set[tuple[int, int]] = set()
    while queue:
        point = queue.popleft()
        if point in seen or point not in background:
            continue
        seen.add(point)
        x, y = point
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))

    for x, y in seen:
        pixels[x, y] = (*pixels[x, y][:3], 0)
    return rgba


def build() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    if image.width % 3 or image.height % 4:
        raise ValueError(f"expected a 3x4 sheet, got {image.size}")

    source_cell_width = image.width // 3
    source_cell_height = image.height // 4
    target_cell = 32
    sheet = Image.new("RGBA", (target_cell * 3, target_cell * 4), (0, 0, 0, 0))
    for row in range(4):
        for column in range(3):
            box = (
                column * source_cell_width,
                row * source_cell_height,
                (column + 1) * source_cell_width,
                (row + 1) * source_cell_height,
            )
            cell = remove_border_background(image.crop(box))
            if cell.size != (target_cell, target_cell):
                cell = cell.resize((target_cell, target_cell), Image.Resampling.NEAREST)
            sheet.alpha_composite(cell, (column * target_cell, row * target_cell))

    for output in OUTPUTS:
        output.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(output)
    print(f"wrote {len(OUTPUTS)} normalized sheets ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    build()
