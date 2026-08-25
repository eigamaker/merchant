"""Copy the imported Craftpix sources needed by the browser runtime.

The ZIPs stay outside the web root.  This script creates stable, URL-friendly
paths for the runtime and a small manifest that can be inspected by the editor.
It intentionally copies PNGs only; TMX/TSX remain in assets-src/vendor for
authoring and are not fetched by the game.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-src" / "vendor" / "craftpix"
PUBLIC = ROOT / "assets-src" / "craftpix-source" / "craftpix"
ACTOR_PUBLIC = ROOT / "public" / "assets" / "actors" / "craftpix"
UI_PUBLIC = ROOT / "public" / "assets" / "ui" / "craftpix"

ACTOR_FILES = {
    "Swordsman_lvl1": ("swordsman", "PNG/Swordsman_lvl1/With_shadow"),
    "Swordsman_lvl2": ("swordsman", "PNG/Swordsman_lvl2/With_shadow"),
    "Swordsman_lvl3": ("swordsman", "PNG/Swordsman_lvl3/With_shadow"),
    "Slime1": ("slimes", "PNG/Slime1/With_shadow"),
    "Slime2": ("slimes", "PNG/Slime2/With_shadow"),
    "Slime3": ("slimes", "PNG/Slime3/With_shadow"),
    "Plant1": ("predator-plants", "PNG/Plant1/With_shadow"),
    "Plant2": ("predator-plants", "PNG/Plant2/With_shadow"),
    "Plant3": ("predator-plants", "PNG/Plant3/With_shadow"),
    "Orc1": ("orcs", "PNG/Orc1/With_shadow"),
    "Orc2": ("orcs", "PNG/Orc2/With_shadow"),
    "Orc3": ("orcs", "PNG/Orc3/With_shadow"),
    "Vampires1": ("vampires", "PNG/Vampires1/With_shadow"),
    "Vampires2": ("vampires", "PNG/Vampires2/With_shadow"),
    "Vampires3": ("vampires", "PNG/Vampires3/With_shadow"),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_file(source: Path, target: Path) -> dict[str, object]:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return {"path": target.relative_to(ROOT / "public").as_posix(), "bytes": source.stat().st_size, "sha256": sha256(source)}


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing imported Craftpix tree: {SOURCE}")
    if PUBLIC.exists():
        for path in sorted(PUBLIC.rglob("*.png"), reverse=True):
            path.unlink()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []
    seen: set[str] = set()
    # Keep one copy of every PNG under a predictable pack path.  The manifest
    # still records duplicates, but the web root does not grow for PNG/Tiled
    # duplicates contained in a vendor archive.
    for pack_dir in sorted(p for p in SOURCE.iterdir() if p.is_dir()):
        for source in sorted((pack_dir / "PNG").rglob("*.png")):
            relative = source.relative_to(pack_dir / "PNG")
            digest = sha256(source)
            if digest in seen:
                continue
            seen.add(digest)
            target = PUBLIC / "packs" / pack_dir.name / relative
            record = copy_file(source, target)
            record.update({"pack": pack_dir.name, "source": source.relative_to(SOURCE).as_posix()})
            records.append(record)

    actor_records: list[dict[str, object]] = []
    for folder, (pack, source_dir) in ACTOR_FILES.items():
        source_root = SOURCE / pack / source_dir
        for source in sorted(source_root.glob("*.png")):
            target = ACTOR_PUBLIC / folder / source.name
            actor_records.append({"id": folder, "actionFile": source.stem, **copy_file(source, target)})

    ui_records: list[dict[str, object]] = []
    ui_root = SOURCE / "rpg-ui" / "PNG"
    for source in sorted(ui_root.glob("*.png")):
        ui_records.append({"id": source.stem, **copy_file(source, UI_PUBLIC / source.name)})

    manifest = {"version": 1, "assets": records, "actors": actor_records, "ui": ui_records}
    (PUBLIC / "runtime-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Copied {len(records)} unique art PNGs, {len(actor_records)} actor sheets, {len(ui_records)} UI sheets")


if __name__ == "__main__":
    main()
