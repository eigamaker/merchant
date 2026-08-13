from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-src"
PUBLIC = ROOT / "public" / "assets"


def write_grass() -> None:
    source = Image.open(SOURCE / "grass-art-reference.png").convert("RGBA")
    scaled = source.resize((384, 384), Image.Resampling.NEAREST)
    scaled.crop((0, 96, 384, 288)).save(PUBLIC / "tiles" / "town_terrain.png")


def alpha_crop(path: Path) -> Image.Image:
    source = Image.open(path).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"transparent result has no visible pixels: {path}")
    return source.crop(bounds)


def contain(source: Image.Image, width: int, height: int) -> Image.Image:
    ratio = min(width / source.width, height / source.height)
    resized = source.resize((max(1, round(source.width * ratio)), max(1, round(source.height * ratio))), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (width, height))
    canvas.alpha_composite(resized, ((width - resized.width) // 2, height - resized.height))
    return canvas


def write_player() -> None:
    frame = contain(alpha_crop(SOURCE / "player-art-alpha.png"), 32, 32)
    sheet = Image.new("RGBA", (128, 128))
    for row in range(4):
        for column in range(4):
            pose = frame.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if row == 1 else frame
            sheet.alpha_composite(pose, (column * 32, row * 32))
    sheet.save(PUBLIC / "actors" / "player.png")


def write_building() -> None:
    building = alpha_crop(SOURCE / "curio-building-alpha.png")
    # The source is an 8x3-wide continuous building; preserve that complete silhouette.
    building.resize((192, 72), Image.Resampling.NEAREST).save(PUBLIC / "preview" / "curio-building.png")


def main() -> None:
    for folder in (PUBLIC / "actors", PUBLIC / "tiles", PUBLIC / "preview"):
        folder.mkdir(parents=True, exist_ok=True)
    write_grass()
    write_player()
    write_building()


if __name__ == "__main__":
    main()
