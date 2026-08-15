#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Merchan.Unity;
using UnityEditor;
using UnityEngine;
using UnityEngine.Tilemaps;

namespace Merchan.Unity.Editor
{
    /// <summary>
    /// Imports the TownFree pack according to its WOLF RPG Editor map-chip
    /// conventions. 16x80 sources are five-part auto-tiles; extra columns are
    /// animation frames. base/world are physical 16px cells, excluding headers.
    /// </summary>
    public sealed class TownFreeMapChipImporter : AssetPostprocessor
    {
        private const string SourceRoot = "Assets/Tiles/TownFree/MapChip/";
        private const string GeneratedRoot = "Assets/Tiles/TownFree/Generated";
        private const string StaticRoot = GeneratedRoot + "/StaticSprites";
        private const string AtlasRoot = GeneratedRoot + "/AutoTileAtlases";
        private const string AutoTileRoot = GeneratedRoot + "/AutoTiles";
        private const string TileRoot = GeneratedRoot + "/Tiles";
        private const int CellSize = 16;
        private const int VariantCount = 256;

        private void OnPreprocessTexture()
        {
            if (!assetPath.StartsWith(SourceRoot, StringComparison.OrdinalIgnoreCase) &&
                !assetPath.StartsWith(GeneratedRoot + "/", StringComparison.OrdinalIgnoreCase))
                return;

            var importer = (TextureImporter)assetImporter;
            importer.textureType = TextureImporterType.Sprite;
            importer.spritePixelsPerUnit = CellSize;
            importer.filterMode = FilterMode.Point;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.mipmapEnabled = false;
            importer.alphaIsTransparency = true;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.maxTextureSize = 8192;

            if (assetPath.StartsWith(AtlasRoot + "/", StringComparison.OrdinalIgnoreCase))
            {
                importer.spriteImportMode = SpriteImportMode.Multiple;
                importer.GetSourceTextureWidthAndHeight(out var width, out var height);
#pragma warning disable 0618 // Unity 6 still exposes spritesheet without the optional 2D Sprite package.
                importer.spritesheet = CreateSpriteGrid(Path.GetFileNameWithoutExtension(assetPath), width, height);
#pragma warning restore 0618
            }
            else
            {
                // Raw 5-cell auto-tiles remain one logical source asset. Physical
                // static crops are also one Sprite per PNG.
                importer.spriteImportMode = SpriteImportMode.Single;
            }
        }

        [MenuItem("Merchan/TownFree/Generate Logical Assets")]
        public static void GenerateLogicalAssets()
        {
            if (!AssetDatabase.IsValidFolder(SourceRoot.TrimEnd('/')))
            {
                Debug.LogError("[TownFree] MapChip source folder is missing.");
                return;
            }

            if (AssetDatabase.IsValidFolder(GeneratedRoot))
                AssetDatabase.DeleteAsset(GeneratedRoot);
            EnsureFolder(GeneratedRoot);
            EnsureFolder(StaticRoot);
            EnsureFolder(AtlasRoot);
            EnsureFolder(AutoTileRoot);
            EnsureFolder(TileRoot);

            var sourcePaths = Directory.GetFiles(ToAbsolute(SourceRoot), "*.png", SearchOption.TopDirectoryOnly)
                .Select(ToAssetPath)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var autoTileSources = new List<string>();
            var staticSpriteCount = 0;

            try
            {
                for (var index = 0; index < sourcePaths.Length; index++)
                {
                    var path = sourcePaths[index];
                    EditorUtility.DisplayProgressBar("TownFree: source definitions", path, (float)index / Math.Max(1, sourcePaths.Length));
                    var source = LoadPng(path);
                    if (source.height == CellSize * 5 && source.width % CellSize == 0)
                    {
                        autoTileSources.Add(path);
                        GenerateAutoTileAtlases(path, source);
                    }
                    else if (string.Equals(Path.GetFileName(path), "base.png", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(Path.GetFileName(path), "world.png", StringComparison.OrdinalIgnoreCase))
                    {
                        staticSpriteCount += SplitStaticAtlas(path, source);
                    }
                    UnityEngine.Object.DestroyImmediate(source);
                }
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }

            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var autoTileCount = CreateAutoTileAssets(autoTileSources);
            var tileCount = CreateStaticTileAssets();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"[TownFree] Generated {autoTileCount} logical auto-tiles, {staticSpriteCount} physical static PNGs and {tileCount} paintable static Tile assets.");
        }

        private static void GenerateAutoTileAtlases(string sourcePath, Texture2D source)
        {
            var name = Path.GetFileNameWithoutExtension(sourcePath);
            var frames = source.width / CellSize;
            var folder = AtlasRoot + "/" + name;
            EnsureFolder(folder);

            for (var frame = 0; frame < frames; frame++)
            {
                var atlas = new Texture2D(CellSize * 16, CellSize * 16, TextureFormat.RGBA32, false);
                atlas.filterMode = FilterMode.Point;
                atlas.SetPixels(new Color[atlas.width * atlas.height]);
                for (var mask = 0; mask < VariantCount; mask++)
                {
                    var outputX = (mask % 16) * CellSize;
                    var outputY = (15 - mask / 16) * CellSize;
                    CopyQuarter(source, atlas, frame, mask, outputX, outputY, true, true);
                    CopyQuarter(source, atlas, frame, mask, outputX, outputY, true, false);
                    CopyQuarter(source, atlas, frame, mask, outputX, outputY, false, true);
                    CopyQuarter(source, atlas, frame, mask, outputX, outputY, false, false);
                }
                atlas.Apply(false, false);
                WritePng(folder + $"/{name}_animation_frame_{frame:D2}.png", atlas);
                UnityEngine.Object.DestroyImmediate(atlas);
            }
        }

        private static void CopyQuarter(Texture2D source, Texture2D target, int frame, int mask, int targetX,
            int targetY, bool top, bool left)
        {
            var verticalBit = top ? 1 : 4;
            var horizontalBit = left ? 8 : 2;
            var diagonalBit = top
                ? (left ? 128 : 16)
                : (left ? 64 : 32);
            var vertical = (mask & verticalBit) != 0;
            var horizontal = (mask & horizontalBit) != 0;
            var diagonal = (mask & diagonalBit) != 0;
            var row = SelectPartRow(vertical, horizontal, diagonal);
            var sourceX = frame * CellSize + (left ? 0 : 8);
            var sourceY = source.height - (row + 1) * CellSize + (top ? 8 : 0);
            var pixels = source.GetPixels(sourceX, sourceY, 8, 8);
            target.SetPixels(targetX + (left ? 0 : 8), targetY + (top ? 8 : 0), 8, 8, pixels);
        }

        private static int SelectPartRow(bool vertical, bool horizontal, bool diagonal)
        {
            if (!vertical && !horizontal) return 0;
            if (vertical && !horizontal) return 1;
            if (!vertical && horizontal) return 2;
            return diagonal ? 4 : 3;
        }

        private static int SplitStaticAtlas(string sourcePath, Texture2D source)
        {
            var sheetName = Path.GetFileNameWithoutExtension(sourcePath);
            var sheetRoot = StaticRoot + "/" + sheetName;
            EnsureFolder(sheetRoot);
            var columns = source.width / CellSize;
            var rows = source.height / CellSize;
            var section = -1;
            var count = 0;

            for (var row = 0; row < rows; row++)
            {
                if (IsHeaderRow(source, row))
                {
                    section++;
                    continue;
                }
                // Rows before the first real category heading are palette UI,
                // not placeable map art.
                if (section < 0 || (sheetName == "base" && row < 4) || (sheetName == "world" && row < 4))
                    continue;

                var category = GetStaticCategory(sheetName, section);
                var folder = sheetRoot + "/" + category;
                EnsureFolder(folder);
                for (var column = 0; column < columns; column++)
                {
                    var pixels = source.GetPixels(column * CellSize, source.height - (row + 1) * CellSize, CellSize, CellSize);
                    if (pixels.All(pixel => pixel.a <= 0.001f))
                        continue;
                    var tile = new Texture2D(CellSize, CellSize, TextureFormat.RGBA32, false);
                    tile.filterMode = FilterMode.Point;
                    tile.SetPixels(pixels);
                    tile.Apply(false, false);
                    WritePng(folder + $"/{sheetName}_{category}_r{row:D3}_c{column:D2}.png", tile);
                    UnityEngine.Object.DestroyImmediate(tile);
                    count++;
                }
            }
            return count;
        }

        private static bool IsHeaderRow(Texture2D source, int visualRow)
        {
            var pixels = source.GetPixels(0, source.height - (visualRow + 1) * CellSize, source.width, CellSize);
            var headerGrey = pixels.Count(pixel => pixel.a > 0.99f &&
                Mathf.RoundToInt(pixel.r * 255f) == 89 &&
                Mathf.RoundToInt(pixel.g * 255f) == 89 &&
                Mathf.RoundToInt(pixel.b * 255f) == 89);
            return headerGrey >= 800;
        }

        private static string GetStaticCategory(string sheetName, int section)
        {
            if (sheetName.Equals("world", StringComparison.OrdinalIgnoreCase))
            {
                switch (section)
                {
                    case 1: return "terrain";
                    case 2: return "objects";
                    case 3: return "dungeon";
                }
            }
            else if (sheetName.Equals("base", StringComparison.OrdinalIgnoreCase))
            {
                // These names follow the category headers embedded in the
                // original base.png sheet. The row/column suffix remains in
                // every filename for exact source traceability.
                var categories = new[]
                {
                    "terrain", "nature_decor", "field", "fence", "bridge_sign",
                    "building_exterior", "interior", "destroyed_ground",
                    "destroyed_wall", "destroyed_field_sign", "destroyed_building_decor",
                    "destroyed_furniture", "destroyed_props", "small_props",
                    "small_props_adjust", "dungeon", "nature_decor_snow",
                    "snow_ground", "snow_fence", "snow_bridge_sign", "snow_roof_window",
                    "shop_sign_props", "damaged_ground", "damaged_wall",
                    "damaged_field_sign", "damaged_building_decor", "damaged_furniture",
                    "damaged_props", "damaged_small_props", "damaged_small_props_adjust"
                };
                if (section >= 1 && section <= categories.Length)
                    return categories[section - 1];
            }

            return $"section_{section:D2}";
        }

        private static int CreateAutoTileAssets(IEnumerable<string> sources)
        {
            var count = 0;
            foreach (var sourcePath in sources)
            {
                var name = Path.GetFileNameWithoutExtension(sourcePath);
                var source = LoadPng(sourcePath);
                var frameCount = source.width / CellSize;
                UnityEngine.Object.DestroyImmediate(source);
                var sprites = new Sprite[frameCount * VariantCount];
                for (var frame = 0; frame < frameCount; frame++)
                {
                    var atlasPath = AtlasRoot + $"/{name}/{name}_animation_frame_{frame:D2}.png";
                    var byName = AssetDatabase.LoadAllAssetsAtPath(atlasPath).OfType<Sprite>()
                        .ToDictionary(sprite => sprite.name, sprite => sprite);
                    for (var mask = 0; mask < VariantCount; mask++)
                        sprites[frame * VariantCount + mask] = byName[$"{name}_animation_frame_{frame:D2}_r{mask / 16:D3}_c{mask % 16:D2}"];
                }

                var asset = ScriptableObject.CreateInstance<TownFreeAutoTile>();
                asset.name = name;
                asset.Configure(sprites, frameCount, 4f, Tile.ColliderType.None);
                AssetDatabase.CreateAsset(asset, AutoTileRoot + "/" + name + ".asset");
                count++;
            }
            return count;
        }

        private static int CreateStaticTileAssets()
        {
            var count = 0;
            var pngGuids = AssetDatabase.FindAssets("t:Texture2D", new[] { StaticRoot });
            foreach (var guid in pngGuids)
            {
                var pngPath = AssetDatabase.GUIDToAssetPath(guid);
                var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(pngPath);
                if (sprite == null)
                    continue;
                var relative = pngPath.Substring((StaticRoot + "/").Length);
                var folder = TileRoot + "/" + Path.GetDirectoryName(relative)?.Replace('\\', '/');
                EnsureFolder(folder);
                var tile = ScriptableObject.CreateInstance<Tile>();
                tile.name = Path.GetFileNameWithoutExtension(pngPath);
                tile.sprite = sprite;
                tile.colliderType = Tile.ColliderType.None;
                AssetDatabase.CreateAsset(tile, folder + "/" + tile.name + ".asset");
                count++;
            }
            return count;
        }

        private static SpriteMetaData[] CreateSpriteGrid(string sheetName, int width, int height)
        {
            var columns = width / CellSize;
            var rows = height / CellSize;
            var sprites = new SpriteMetaData[columns * rows];
            var index = 0;
            for (var row = 0; row < rows; row++)
            for (var column = 0; column < columns; column++)
            {
                sprites[index++] = new SpriteMetaData
                {
                    name = $"{sheetName}_r{row:D3}_c{column:D2}",
                    rect = new Rect(column * CellSize, height - (row + 1) * CellSize, CellSize, CellSize),
                    alignment = (int)SpriteAlignment.Center,
                    pivot = new Vector2(0.5f, 0.5f),
                    border = Vector4.zero,
                };
            }
            return sprites;
        }

        private static Texture2D LoadPng(string assetPath)
        {
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!ImageConversion.LoadImage(texture, File.ReadAllBytes(ToAbsolute(assetPath)), false))
                throw new InvalidOperationException("Unable to decode " + assetPath);
            return texture;
        }

        private static void WritePng(string assetPath, Texture2D texture)
        {
            var absolute = ToAbsolute(assetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolute) ?? throw new InvalidOperationException(assetPath));
            File.WriteAllBytes(absolute, texture.EncodeToPNG());
        }

        private static string ToAbsolute(string assetPath) => Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), assetPath));

        private static string ToAssetPath(string absolutePath)
        {
            var projectRoot = Path.GetFullPath(Directory.GetCurrentDirectory()).Replace('\\', '/').TrimEnd('/');
            return Path.GetFullPath(absolutePath).Replace('\\', '/').Replace(projectRoot + "/", string.Empty);
        }

        private static void EnsureFolder(string path)
        {
            var normalized = path.Replace('\\', '/').Trim('/');
            var parts = normalized.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index++)
            {
                var next = current + "/" + parts[index];
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }
    }
}
#endif
