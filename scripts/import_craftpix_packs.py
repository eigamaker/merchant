"""Import the approved runtime files from Craftpix ZIP packs.

The ZIP archives are treated as source material only.  The browser and the
game never read an archive directly; this command extracts a small, stable
vendor tree and a provenance manifest that can be checked into the project.

Example:
    python scripts/import_craftpix_packs.py --source-root I:\\ダウンロード
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ROOT = Path(r"I:\ダウンロード")
DEFAULT_OUTPUT = ROOT / "assets-src" / "vendor" / "craftpix"


@dataclass(frozen=True)
class PackSpec:
    pack_id: str
    archive_name: str
    # Keep all PNG/TMX files for the pack's useful art folders, but never PSDs
    # or the vendor's preview/coupon metadata.
    include_prefixes: tuple[str, ...]


PACKS = (
    PackSpec("dungeon-base", "craftpix-net-169442-free-2d-top-down-pixel-dungeon-asset-pack.zip", ("PNG/", "Tiled_files/")),
    PackSpec("rpg-ui", "craftpix-net-255216-free-basic-pixel-art-ui-for-rpg.zip", ("PNG/",)),
    PackSpec("predator-plants", "craftpix-net-284465-free-predator-plant-mobs-pixel-art-pack.zip", ("PNG/", "Tiled_files/")),
    PackSpec("orcs", "craftpix-net-363992-free-top-down-orc-game-character-pixel-art.zip", ("PNG/", "Tiled_files/")),
    PackSpec("glassblower-workshop", "craftpix-net-692491-free-glassblowers-workshop-top-down-pixel-art-asset.zip", ("PNG/", "Tiled_files/")),
    PackSpec("swordsman", "craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character.zip", ("PNG/", "Tiled_files/")),
    PackSpec("main-home", "craftpix-net-654184-main-characters-home-free-top-down-pixel-art-asset.zip", ("PNG/", "Tiled_files/")),
    PackSpec("dungeon-objects", "craftpix-net-218281-free-pixel-art-dungeon-objects-asset-pack.zip", ("PNG/", "Tiled_files/")),
    PackSpec("vampires", "craftpix-net-208004-free-vampire-4-direction-pixel-character-sprite-pack.zip", ("PNG/", "Tiled/")),
    PackSpec("slimes", "craftpix-net-788364-free-slime-mobs-pixel-art-top-down-sprite-pack.zip", ("PNG/", "Tiled_files/")),
    PackSpec("guild-hall", "craftpix-net-189780-free-top-down-pixel-art-guild-hall-asset-pack.zip", ("PNG/", "Tiled_files/")),
)


ALLOWED_EXTENSIONS = {".png", ".tmx", ".tsx", ".txt"}
SKIP_PARTS = {"__MACOSX", "PSD"}


def png_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def safe_relative(name: str) -> Path | None:
    path = Path(name.replace("\\", "/"))
    if not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        return None
    if any(part in SKIP_PARTS for part in path.parts):
        return None
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        return None
    return path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def import_pack(spec: PackSpec, source_root: Path, output_root: Path) -> dict[str, object]:
    archive = source_root / spec.archive_name
    if not archive.exists():
        raise FileNotFoundError(f"missing Craftpix archive: {archive}")
    pack_output = output_root / spec.pack_id
    pack_output.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, object]] = []
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            relative = safe_relative(info.filename)
            root_notice = relative is not None and len(relative.parts) == 1 and relative.name.lower() in {"license.txt", "readme.txt"}
            if relative is None or (not root_notice and not any(info.filename.startswith(prefix) for prefix in spec.include_prefixes)):
                continue
            data = source.read(info)
            target = pack_output / ("license.txt" if root_notice and relative.name.lower() == "license.txt" else relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            record: dict[str, object] = {
                "path": relative.as_posix(),
                "bytes": len(data),
                "sha256": sha256(data),
            }
            size = png_size(data)
            if size is not None:
                record["width"], record["height"] = size
            files.append(record)
    return {
        "id": spec.pack_id,
        "archive": spec.archive_name,
        "license": f"{spec.pack_id}/license.txt" if (pack_output / "license.txt").exists() else None,
        "files": sorted(files, key=lambda item: str(item["path"])),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--pack", action="append", dest="packs", help="only import this pack id; repeatable")
    args = parser.parse_args()

    selected = [pack for pack in PACKS if not args.packs or pack.pack_id in args.packs]
    unknown = set(args.packs or ()) - {pack.pack_id for pack in PACKS}
    if unknown:
        raise SystemExit(f"unknown pack id(s): {', '.join(sorted(unknown))}")

    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1,
        "sourceRoot": str(args.source_root),
        "packs": [import_pack(pack, args.source_root, args.output) for pack in selected],
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(selected)} Craftpix pack(s) into {args.output}")


if __name__ == "__main__":
    main()
