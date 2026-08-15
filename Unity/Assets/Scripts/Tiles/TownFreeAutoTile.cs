using UnityEngine;
using UnityEngine.Tilemaps;

namespace Merchan.Unity
{
    /// <summary>
    /// A WOLF RPG Editor style auto-tile. One logical material owns every
    /// adjacency shape and every animation frame, so painters never select
    /// internal pieces or animation frames directly.
    /// </summary>
    [CreateAssetMenu(fileName = "TownFreeAutoTile", menuName = "Merchan/TownFree Auto Tile")]
    public sealed class TownFreeAutoTile : TileBase
    {
        private const int VariantCount = 256;

        [SerializeField] private Sprite[] sprites = new Sprite[VariantCount];
        [SerializeField, Min(1)] private int frameCount = 1;
        [SerializeField, Min(0.1f)] private float animationSpeed = 4f;
        [SerializeField] private Tile.ColliderType colliderType = Tile.ColliderType.None;

        public void Configure(Sprite[] generatedSprites, int generatedFrameCount, float speed, Tile.ColliderType collider)
        {
            sprites = generatedSprites;
            frameCount = Mathf.Max(1, generatedFrameCount);
            animationSpeed = Mathf.Max(0.1f, speed);
            colliderType = collider;
        }

        public override void RefreshTile(Vector3Int position, ITilemap tilemap)
        {
            // Any neighbor change can alter one of the four composed corners.
            for (var y = -1; y <= 1; y++)
            for (var x = -1; x <= 1; x++)
                tilemap.RefreshTile(position + new Vector3Int(x, y, 0));
        }

        public override void GetTileData(Vector3Int position, ITilemap tilemap, ref TileData tileData)
        {
            var mask = GetNeighborMask(position, tilemap);
            tileData.sprite = GetSprite(0, mask);
            tileData.color = Color.white;
            tileData.transform = Matrix4x4.identity;
            tileData.gameObject = null;
            tileData.flags = TileFlags.LockColor | TileFlags.LockTransform;
            tileData.colliderType = colliderType;
        }

        public override bool GetTileAnimationData(Vector3Int position, ITilemap tilemap, ref TileAnimationData tileAnimationData)
        {
            if (frameCount <= 1 || sprites == null || sprites.Length < frameCount * VariantCount)
                return false;

            var mask = GetNeighborMask(position, tilemap);
            var animationFrames = new Sprite[frameCount];
            for (var frame = 0; frame < frameCount; frame++)
                animationFrames[frame] = GetSprite(frame, mask);

            tileAnimationData.animatedSprites = animationFrames;
            tileAnimationData.animationSpeed = animationSpeed;
            tileAnimationData.animationStartTime = 0f;
            tileAnimationData.flags = TileAnimationFlags.None;
            return true;
        }

        private Sprite GetSprite(int frame, int mask)
        {
            var index = frame * VariantCount + mask;
            return sprites != null && index >= 0 && index < sprites.Length ? sprites[index] : null;
        }

        private int GetNeighborMask(Vector3Int position, ITilemap tilemap)
        {
            var mask = 0;
            if (IsSame(tilemap, position + Vector3Int.up)) mask |= 1;
            if (IsSame(tilemap, position + Vector3Int.right)) mask |= 2;
            if (IsSame(tilemap, position + Vector3Int.down)) mask |= 4;
            if (IsSame(tilemap, position + Vector3Int.left)) mask |= 8;
            if (IsSame(tilemap, position + new Vector3Int(1, 1, 0))) mask |= 16;
            if (IsSame(tilemap, position + new Vector3Int(1, -1, 0))) mask |= 32;
            if (IsSame(tilemap, position + new Vector3Int(-1, -1, 0))) mask |= 64;
            if (IsSame(tilemap, position + new Vector3Int(-1, 1, 0))) mask |= 128;
            return mask;
        }

        private bool IsSame(ITilemap tilemap, Vector3Int position) => tilemap.GetTile(position) == this;
    }
}
