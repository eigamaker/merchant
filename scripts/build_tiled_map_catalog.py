"""Build the shared, source-faithful map-art catalog from Craftpix TMX files.

The vendor TMX files are the authority for image dimensions, tile columns,
animation sequences and layer order.  Runtime PNG files under ``PNG/`` are
often a different export and must not be paired with these frame numbers.
"""

from __future__ import annotations

import csv
import io
import json
import re
import shutil
import xml.etree.ElementTree as ET
from collections import OrderedDict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "assets-src" / "vendor" / "craftpix"
PUBLIC = ROOT / "public" / "assets" / "craftpix"
OUTPUT = PUBLIC / "tiled-map-catalog.json"
AUDIT_OUTPUT = PUBLIC / "tiled-map-audit.json"
TS_OUTPUT = ROOT / "src" / "game" / "tiledMapSheets.generated.ts"

SOURCE_MAPS = (
    ("dungeon-base", "Dungeon1", "dungeon-base/Tiled_files/Dungeon1.tmx"),
    ("main-home", "home-exterior", "main-home/Tiled_files/Exterior.tmx"),
    ("main-home", "home-interior", "main-home/Tiled_files/Interior1.tmx"),
    ("guild-hall", "guild-exterior", "guild-hall/Tiled_files/Exterior.tmx"),
    ("guild-hall", "guild-interior-1", "guild-hall/Tiled_files/Interior_1st_floor.tmx"),
    ("guild-hall", "guild-interior-2", "guild-hall/Tiled_files/Interior_2nd_floor.tmx"),
    ("glassblower-workshop", "glassblower-exterior", "glassblower-workshop/Tiled_files/Exterior.tmx"),
    ("glassblower-workshop", "glassblower-interior", "glassblower-workshop/Tiled_files/Interior.tmx"),
    ("dungeon-objects", "dungeon-objects", "dungeon-objects/Tiled_files/Dungeon1_objects.tmx"),
)

GID_MASK = 0x1FFFFFFF
FLIP_X = 0x80000000
FLIP_Y = 0x40000000
FLIP_DIAGONAL = 0x20000000

TERRAIN_SHEET_WORDS = ("wall", "floor", "ground", "water", "coast", "crack")


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def layer_kind(name: str) -> str:
    lower = name.lower()
    if any(word in lower for word in ("light", "lights")):
        return "light"
    if any(word in lower for word in ("roof", "top", "window", "windows", "bird")):
        return "overhead"
    if "wall" in lower or lower in {"house", "tent", "forge"}:
        return "structure"
    if any(word in lower for word in ("floor", "ground", "grass", "road", "bricks", "water", "carpet", "plates")):
        return "ground"
    return "decoration"


def tile_values(data: ET.Element) -> list[int]:
    text = (data.text or "").strip()
    if not text:
        return []
    return [int(value) for row in csv.reader(io.StringIO(text)) for value in row if value.strip()]


def local_bounds(layers: list[dict[str, object]]) -> dict[str, int]:
    cells = [placement for layer in layers for placement in layer["placements"]]
    if not cells:
        return {"x": 0, "y": 0, "width": 1, "height": 1}
    min_x = min(cell["x"] for cell in cells)
    max_x = max(cell["x"] for cell in cells)
    min_y = min(cell["y"] for cell in cells)
    max_y = max(cell["y"] for cell in cells)
    return {"x": min_x, "y": min_y, "width": max_x - min_x + 1, "height": max_y - min_y + 1}


def source_component_candidates(map_id: str, layers: list[dict[str, object]]) -> list[dict[str, object]]:
    """Split every source-layer sheet into connected placement components.

    Tiled records an animation for *each tile cell*.  A flag or character is
    consequently several synchronized tile animations, not several assets to
    be selected independently.  The source map is the only authoritative
    record of which cells form one metatile, so keep every component for the
    sheets that prove to contain at least one multi-cell animation.
    """
    candidates: list[dict[str, object]] = []
    for layer in layers:
        by_sheet: dict[str, dict[tuple[int, int], dict[str, object]]] = {}
        for placement in layer["placements"]:
            by_sheet.setdefault(placement["sheet"], {})[(placement["x"], placement["y"])] = placement
        for sheet, cells in by_sheet.items():
            visited: set[tuple[int, int]] = set()
            for start in cells:
                if start in visited:
                    continue
                component: set[tuple[int, int]] = set()
                pending = [start]
                while pending:
                    cell = pending.pop()
                    if cell in component or cell not in cells:
                        continue
                    component.add(cell)
                    x, y = cell
                    pending.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
                visited.update(component)
                min_x = min(x for x, _ in component)
                min_y = min(y for _, y in component)
                max_x = max(x for x, _ in component)
                max_y = max(y for _, y in component)
                ordered = [cells[cell] for cell in sorted(component, key=lambda cell: (cell[1], cell[0]))]
                candidates.append({
                    "id": f"tiled-prefab:{map_id}:{slug(layer['name'])}:{sheet}:{min_x}:{min_y}",
                    "label": f"{map_id}: {layer['name']} ({min_x},{min_y})",
                    "sourceMap": map_id,
                    "sourceLayer": layer["name"],
                    "sourceKind": layer["kind"],
                    "sourceOrigin": {"x": min_x, "y": min_y},
                    "sheet": sheet,
                    "width": max_x - min_x + 1,
                    "height": max_y - min_y + 1,
                    "containsAnimation": any(placement.get("animationId") for placement in ordered),
                    "provesComposite": layer["kind"] != "ground" and len(component) > 1 and any(placement.get("animationId") for placement in ordered),
                    "placements": [{
                        **placement,
                        "x": placement["x"] - min_x,
                        "y": placement["y"] - min_y,
                        "layer": layer["kind"],
                    } for placement in ordered],
                })
    return candidates


def atlas_components(record: dict[str, object]) -> list[dict[str, object]]:
    """Recover static object bounds from alpha continuity across tile edges."""
    source = ROOT / record["source"]
    with Image.open(source).convert("RGBA") as image:
        alpha = image.getchannel("A")
        columns = int(record["columns"])
        frames = int(record["frames"])
        occupied = {
            frame for frame in range(frames)
            if alpha.crop(((frame % columns) * 16, (frame // columns) * 16, (frame % columns + 1) * 16, (frame // columns + 1) * 16)).getbbox()
        }

        def connected(first: int, second: int, direction: str) -> bool:
            first_x = (first % columns) * 16
            first_y = (first // columns) * 16
            second_x = (second % columns) * 16
            second_y = (second // columns) * 16
            if direction == "right":
                return any(
                    alpha.getpixel((first_x + 15, first_y + y)) and alpha.getpixel((second_x, second_y + next_y))
                    for y in range(16) for next_y in range(max(0, y - 1), min(16, y + 2))
                )
            return any(
                alpha.getpixel((first_x + x, first_y + 15)) and alpha.getpixel((second_x + next_x, second_y))
                for x in range(16) for next_x in range(max(0, x - 1), min(16, x + 2))
            )

        neighbors: dict[int, set[int]] = {frame: set() for frame in occupied}
        for frame in occupied:
            column = frame % columns
            row = frame // columns
            right = frame + 1
            below = frame + columns
            if column + 1 < columns and right in occupied and connected(frame, right, "right"):
                neighbors[frame].add(right)
                neighbors[right].add(frame)
            if below in occupied and connected(frame, below, "down"):
                neighbors[frame].add(below)
                neighbors[below].add(frame)

    sheet_id = str(record["id"])
    if any(word in sheet_id for word in ("wall", "exterior", "house")):
        layer = "structure"
    elif any(word in sheet_id for word in ("ground", "floor")):
        layer = "ground"
    else:
        layer = "decoration"
    prefabs: list[dict[str, object]] = []
    visited: set[int] = set()
    for start in sorted(occupied):
        if start in visited:
            continue
        component: set[int] = set()
        pending = [start]
        while pending:
            frame = pending.pop()
            if frame in component:
                continue
            component.add(frame)
            pending.extend(neighbors[frame] - component)
        visited.update(component)
        min_column = min(frame % columns for frame in component)
        max_column = max(frame % columns for frame in component)
        min_row = min(frame // columns for frame in component)
        max_row = max(frame // columns for frame in component)
        prefabs.append({
            "id": f"atlas-prefab:{record['id']}:{min_column}:{min_row}",
            "label": "",
            "sourceMap": None,
            "sourceLayer": "PNG alpha bounds",
            "sourceOrigin": {"x": min_column, "y": min_row},
            "sheet": record["id"],
            "width": max_column - min_column + 1,
            "height": max_row - min_row + 1,
            "placements": [{
                "sheet": record["id"],
                "frame": frame,
                "animationId": None,
                "x": frame % columns - min_column,
                "y": frame // columns - min_row,
                "layer": layer,
                "flipX": False,
                "flipY": False,
                "flipDiagonal": False,
            } for frame in sorted(component)],
        })
    for index, prefab in enumerate(prefabs, start=1):
        prefab["label"] = f"{record['label']} #{index:02d}"
    return prefabs


def main() -> None:
    sheets: OrderedDict[str, dict[str, object]] = OrderedDict()
    animations: OrderedDict[str, dict[str, object]] = OrderedDict()
    maps: list[dict[str, object]] = []
    composite_sheets: set[str] = set()
    component_candidates: list[dict[str, object]] = []

    for pack, map_id, relative in SOURCE_MAPS:
        path = VENDOR / relative
        root = ET.parse(path).getroot()
        if root.attrib.get("orientation") != "orthogonal" or root.attrib.get("tilewidth") != "16" or root.attrib.get("tileheight") != "16":
            raise RuntimeError(f"{relative} must be a 16px orthogonal TMX")

        tilesets: list[dict[str, object]] = []
        for tileset in root.findall("tileset"):
            image = tileset.find("image")
            if image is None or not image.attrib.get("source"):
                continue
            source = (path.parent / image.attrib["source"]).resolve()
            if not source.exists():
                # Some vendor maps contain non-essential demo references that
                # were not included in the archive.  They cannot be rendered.
                continue
            columns = int(tileset.attrib["columns"])
            count = int(tileset.attrib["tilecount"])
            sheet_id = f"{slug(pack)}-{slug(source.stem)}"
            public_relative = Path("assets/craftpix/tiled-map-sheets") / slug(pack) / source.name
            record = {
                "id": sheet_id,
                "label": f"{pack}: {tileset.attrib.get('name', source.stem)}",
                "path": public_relative.as_posix(),
                "columns": columns,
                "frames": count,
                "source": source.relative_to(ROOT).as_posix(),
            }
            existing = sheets.get(sheet_id)
            if existing and {key: existing[key] for key in ("columns", "frames", "source")} != {key: record[key] for key in ("columns", "frames", "source")}:
                raise RuntimeError(f"conflicting tileset definition for {sheet_id}")
            sheets[sheet_id] = record
            tilesets.append({"firstgid": int(tileset.attrib["firstgid"]), "sheet": sheet_id, "columns": columns})

            for tile in tileset.findall("tile"):
                animation = tile.find("animation")
                if animation is None:
                    continue
                tile_id = int(tile.attrib["id"])
                frames = [
                    {"frame": int(frame.attrib["tileid"]), "duration": int(frame.attrib.get("duration", "100"))}
                    for frame in animation.findall("frame")
                ]
                if not frames:
                    continue
                animation_id = f"tiled:{sheet_id}:{tile_id}"
                clip = {"id": animation_id, "sheet": sheet_id, "representative": frames[0]["frame"], "frames": frames, "loop": True}
                existing_clip = animations.get(animation_id)
                if existing_clip and existing_clip != clip:
                    raise RuntimeError(f"conflicting animation definition for {animation_id}")
                animations[animation_id] = clip

        tilesets.sort(key=lambda item: item["firstgid"])

        def source_for(gid: int) -> dict[str, object] | None:
            matches = [tileset for tileset in tilesets if tileset["firstgid"] <= gid]
            return matches[-1] if matches else None

        layers: list[dict[str, object]] = []
        for layer in root.findall("layer"):
            placements: list[dict[str, object]] = []
            data = layer.find("data")
            if data is None:
                continue
            chunks = data.findall("chunk")
            if not chunks:
                chunks = [data]
            for chunk in chunks:
                width = int(chunk.attrib.get("width", layer.attrib.get("width", "0")))
                origin_x = int(chunk.attrib.get("x", "0"))
                origin_y = int(chunk.attrib.get("y", "0"))
                if width <= 0:
                    continue
                for index, raw in enumerate(tile_values(chunk)):
                    gid = raw & GID_MASK
                    if gid == 0:
                        continue
                    source = source_for(gid)
                    if source is None:
                        continue
                    frame = gid - source["firstgid"]
                    if frame < 0 or frame >= sheets[source["sheet"]]["frames"]:
                        raise RuntimeError(f"invalid frame {frame} in {relative}")
                    animation_id = f"tiled:{source['sheet']}:{frame}"
                    placements.append({
                        "sheet": source["sheet"],
                        "frame": frame,
                        "animationId": animation_id if animation_id in animations else None,
                        "x": origin_x + index % width,
                        "y": origin_y + index // width,
                        "flipX": bool(raw & FLIP_X),
                        "flipY": bool(raw & FLIP_Y),
                        "flipDiagonal": bool(raw & FLIP_DIAGONAL),
                    })
            if placements:
                layers.append({"name": layer.attrib.get("name", "Layer"), "kind": layer_kind(layer.attrib.get("name", "")), "placements": placements})
        map_candidates = source_component_candidates(map_id, layers)
        component_candidates.extend(map_candidates)
        composite_sheets.update(candidate["sheet"] for candidate in map_candidates if candidate["provesComposite"])
        maps.append({"id": map_id, "pack": pack, "tileSize": 16, "bounds": local_bounds(layers), "layers": layers})

    for record in sheets.values():
        source = ROOT / record["source"]
        target = ROOT / "public" / record["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    animated_sheets = {clip["sheet"] for clip in animations.values()}
    atlas_prefabs_by_sheet: dict[str, list[dict[str, object]]] = {}
    atlas_frame_counts: dict[str, int] = {}
    atlas_metatile_sheets: set[str] = set()
    for sheet_id, record in sheets.items():
        if sheet_id in animated_sheets:
            continue
        sheet_atlas_prefabs = atlas_components(record)
        atlas_prefabs_by_sheet[sheet_id] = sheet_atlas_prefabs
        atlas_frame_counts[sheet_id] = sum(len(prefab["placements"]) for prefab in sheet_atlas_prefabs)
        # Static Craftpix sheets frequently use transparent spacer cells to
        # separate complete multi-cell assets.  Those spacers are the only
        # object-boundary information stored by walls_floor and similar TMX
        # tilesets, whose XML otherwise declares only a flat 16px grid.
        has_transparent_spacers = atlas_frame_counts[sheet_id] < int(record["frames"])
        has_separate_assets = len(sheet_atlas_prefabs) > 1
        has_multicell_asset = any(len(prefab["placements"]) > 1 for prefab in sheet_atlas_prefabs)
        if has_transparent_spacers and has_separate_assets and has_multicell_asset:
            atlas_metatile_sheets.add(sheet_id)

    source_metatile_sheets: set[str] = set()
    for candidate in component_candidates:
        terrain_sheet = any(word in candidate["sheet"] for word in TERRAIN_SHEET_WORDS)
        if not terrain_sheet and candidate["sourceKind"] != "ground" and len(candidate["placements"]) > 1:
            source_metatile_sheets.add(candidate["sheet"])
    metatile_sheets = composite_sheets | source_metatile_sheets | atlas_metatile_sheets
    prefabs = []
    for candidate in component_candidates:
        sheet_id = candidate["sheet"]
        if sheet_id not in composite_sheets and (sheet_id not in source_metatile_sheets or sheet_id in atlas_metatile_sheets):
            continue
        prefab = {key: value for key, value in candidate.items() if key not in {"containsAnimation", "provesComposite"}}
        prefabs.append(prefab)
    for sheet_id in sheets:
        if sheet_id in atlas_metatile_sheets:
            prefabs.extend(atlas_prefabs_by_sheet[sheet_id])
    for sheet_id, record in sheets.items():
        record["animationMode"] = "composite" if sheet_id in composite_sheets else "tile" if sheet_id in animated_sheets else "none"
        record["usageMode"] = "metatile" if sheet_id in metatile_sheets else "tile"

    audit = []
    for sheet_id, record in sheets.items():
        clips = [clip for clip in animations.values() if clip["sheet"] == sheet_id]
        sheet_prefabs = [prefab for prefab in prefabs if prefab["sheet"] == sheet_id]
        source_placements = sum(
            1 for source_map in maps for layer in source_map["layers"] for placement in layer["placements"]
            if placement["sheet"] == sheet_id
        )
        prefab_placements = sum(len(prefab["placements"]) for prefab in sheet_prefabs)
        coverage_basis = "png-alpha" if sheet_id in atlas_metatile_sheets else "source-map" if sheet_id in metatile_sheets else "tile"
        definition_placements = atlas_frame_counts.get(sheet_id, source_placements) if coverage_basis == "png-alpha" else source_placements
        audit.append({
            "sheet": sheet_id,
            "source": record["source"],
            "animationMode": record["animationMode"],
            "usageMode": record["usageMode"],
            "tileAnimationCount": len(clips),
            "integratedPrefabCount": len(sheet_prefabs),
            "sourcePlacementCount": source_placements,
            "prefabPlacementCount": prefab_placements,
            "coverageBasis": coverage_basis,
            "definitionPlacementCount": definition_placements,
            "definitionCoverage": prefab_placements == definition_placements if record["usageMode"] == "metatile" else True,
            "footprints": [{"width": prefab["width"], "height": prefab["height"], "placements": len(prefab["placements"])} for prefab in sheet_prefabs],
            "rule": "metatile-only" if record["usageMode"] == "metatile" else "single-cell-tile",
        })

    payload = {"version": 2, "tileSize": 16, "sheets": list(sheets.values()), "animations": list(animations.values()), "prefabs": prefabs, "sourceMaps": maps, "audit": audit}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    AUDIT_OUTPUT.write_text(json.dumps({"version": 1, "scope": [relative for _, _, relative in SOURCE_MAPS], "sheets": audit}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    entries = ",\n".join(
        f"  {{ id: {record['id']!r}, label: {record['label']!r}, path: {record['path']!r}, columns: {record['columns']}, frames: {record['frames']}, animationMode: {record['animationMode']!r}, usageMode: {record['usageMode']!r} }}"
        for record in sheets.values()
    )
    TS_OUTPUT.write_text(
        "// Generated by scripts/build_tiled_map_catalog.py. Do not edit.\n"
        "export interface TiledMapSheet { id: string; label: string; path: string; columns: number; frames: number; animationMode: 'none' | 'tile' | 'composite'; usageMode: 'tile' | 'metatile'; }\n"
        "export const TILED_MAP_SHEETS: readonly TiledMapSheet[] = [\n" + entries + "\n];\n"
        "export const TILED_MAP_SHEETS_BY_ID: Readonly<Record<string, TiledMapSheet>> = Object.fromEntries(TILED_MAP_SHEETS.map((sheet) => [sheet.id, sheet]));\n",
        encoding="utf-8",
    )
    print(f"generated {len(sheets)} sheets, {len(animations)} animations, {len(prefabs)} prefabs and {len(maps)} source maps")


if __name__ == "__main__":
    main()
