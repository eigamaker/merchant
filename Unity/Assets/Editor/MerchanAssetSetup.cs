using UnityEditor;
using UnityEngine;

namespace Merchan.Unity.Editor
{
    /// <summary>Keeps pixel art crisp when the source assets are imported by Unity.</summary>
    public sealed class MerchanAssetSetup : AssetPostprocessor
    {
        private void OnPreprocessTexture()
        {
            if (!assetPath.StartsWith("Assets/Resources/Merchan/assets/"))
                return;

            var importer = (TextureImporter)assetImporter;
            importer.textureType = TextureImporterType.Sprite;
            // TownFree map cells are 16px and the Craftpix actor sheets use
            // 64px source cells that represent four map tiles. Keep both
            // contracts at 16px-per-unit so the visible actor art and the
            // map grid share one pixel scale.
            importer.spritePixelsPerUnit = assetPath.Contains("/assets/actors/craftpix/") ? 16 : 24;
            importer.filterMode = FilterMode.Point;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.mipmapEnabled = false;
        }
    }
}
