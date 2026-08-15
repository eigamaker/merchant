#if UNITY_EDITOR
using System.IO;
using Merchan.Unity;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Tilemaps;

namespace Merchan.Unity.Editor
{
    public static class TownTilemapBuilder
    {
        private const string TownFreeRoot = "Assets/Tiles/TownFree/Generated";
        private const string SceneTileRoot = TownFreeRoot + "/SceneTiles";
        private const string ScenePath = "Assets/Scenes/TownAuthoring.unity";
        private const string LayoutPath = "Assets/Resources/Merchan/Data/townLayout.json";

        [InitializeOnLoadMethod]
        private static void RestoreEmptyTownAuthoring()
        {
            EditorApplication.delayCall += delegate
            {
                if (SceneManager.GetActiveScene().path != ScenePath)
                    return;
                var ground = GameObject.Find("TownGrid/Ground")?.GetComponent<Tilemap>();
                if (ground != null && !ground.HasTile(Vector3Int.zero))
                    PaintAndSave();
            };
        }

        [MenuItem("Merchan/Build Town Tilemap Scene")]
        public static void BuildFromMenu()
        {
            EnsureFolder(SceneTileRoot);
            var collisionTile = CreateCollisionTile();
            // Persist every TileBase before the scene starts referencing it.
            // Saving assets after painting can invalidate newly created object
            // handles while Unity is serializing a fresh scene.
            AssetDatabase.SaveAssets();
            var grass = AssetDatabase.LoadAssetAtPath<TownFreeAutoTile>(TownFreeRoot + "/AutoTiles/kusa1.asset");
            var road = AssetDatabase.LoadAssetAtPath<TownFreeAutoTile>(TownFreeRoot + "/AutoTiles/tuti1.asset");
            if (grass == null || road == null)
            {
                Debug.LogError("[Merchan] TownFree logical assets are missing. Run Merchan/TownFree/Generate Logical Assets first.");
                return;
            }

            var layout = JsonUtility.FromJson<TownLayout>(File.ReadAllText(LayoutPath));
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var gridObject = new GameObject("TownGrid");
            var grid = gridObject.AddComponent<Grid>();
            grid.cellSize = Vector3.one;

            var ground = CreateTilemap(gridObject.transform, "Ground", 0);
            var roads = CreateTilemap(gridObject.transform, "Roads", 5);
            CreateTilemap(gridObject.transform, "Buildings", 10);
            CreateTilemap(gridObject.transform, "Props", 20);
            var collision = CreateTilemap(gridObject.transform, "Collision", 0);
            collision.GetComponent<TilemapRenderer>().enabled = false;
            var body = collision.gameObject.AddComponent<Rigidbody2D>();
            body.bodyType = RigidbodyType2D.Static;
            var collider = collision.gameObject.AddComponent<TilemapCollider2D>();
            collider.compositeOperation = Collider2D.CompositeOperation.Merge;
            collision.gameObject.AddComponent<CompositeCollider2D>();

            new GameObject("Merchan Bootstrap").AddComponent<MerchanBootstrap>();
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = layout.height * 0.5f;
            camera.backgroundColor = new Color(0.06f, 0.08f, 0.11f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            cameraObject.transform.position = new Vector3(layout.width * 0.5f, layout.height * 0.5f, -10f);

            Selection.activeGameObject = gridObject;
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);

            // Unity 6 initializes freshly added Tilemaps on the next editor
            // update. Deferring the paint pass keeps SetTile from being ignored.
            if (Application.isBatchMode)
                PaintAndSave();
            else
            {
                EditorApplication.delayCall -= PaintAndSave;
                EditorApplication.delayCall += PaintAndSave;
            }
        }

        private static void PaintAndSave()
        {
            var layout = JsonUtility.FromJson<TownLayout>(File.ReadAllText(LayoutPath));
            var grass = AssetDatabase.LoadAssetAtPath<TownFreeAutoTile>(TownFreeRoot + "/AutoTiles/kusa1.asset");
            var road = AssetDatabase.LoadAssetAtPath<TownFreeAutoTile>(TownFreeRoot + "/AutoTiles/tuti1.asset");
            var collisionTile = AssetDatabase.LoadAssetAtPath<Tile>(SceneTileRoot + "/collision_blocked.asset");
            var ground = GameObject.Find("TownGrid/Ground")?.GetComponent<Tilemap>();
            var roads = GameObject.Find("TownGrid/Roads")?.GetComponent<Tilemap>();
            var collision = GameObject.Find("TownGrid/Collision")?.GetComponent<Tilemap>();
            if (grass == null || road == null || collisionTile == null || ground == null || roads == null || collision == null)
            {
                Debug.LogError("[Merchan] TownAuthoring paint pass could not resolve its TownFree assets or Tilemaps.");
                return;
            }

            ground.ClearAllTiles();
            roads.ClearAllTiles();
            collision.ClearAllTiles();
            for (var y = 0; y < layout.height; y++)
            for (var x = 0; x < layout.width; x++)
            {
                var cell = new Vector3Int(x, layout.height - 1 - y, 0);
                ground.SetTile(cell, grass);
                if (layout.collision[y][x] == '#')
                    collision.SetTile(cell, collisionTile);
            }

            PaintHorizontal(roads, road, 0, layout.width - 1, 26);
            PaintVertical(roads, road, layout.height, 30);
            PaintHorizontal(roads, road, 8, 23, 17);
            PaintHorizontal(roads, road, 29, 52, 34);
            ground.CompressBounds();
            roads.CompressBounds();
            collision.CompressBounds();
            ground.RefreshAllTiles();
            roads.RefreshAllTiles();
            EditorUtility.SetDirty(ground);
            EditorUtility.SetDirty(roads);
            EditorUtility.SetDirty(collision);
            var scene = SceneManager.GetActiveScene();
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log($"[Merchan] Rebuilt TownAuthoring with TownFree 16px auto-tiles ({layout.width}x{layout.height}); cells={CountCells(ground)}/{CountCells(roads)}/{CountCells(collision)}.");
        }

        private static Tilemap CreateTilemap(Transform parent, string name, int sortingOrder)
        {
            var obj = new GameObject(name);
            obj.transform.SetParent(parent, false);
            var tilemap = obj.AddComponent<Tilemap>();
            var renderer = obj.AddComponent<TilemapRenderer>();
            renderer.sortingOrder = sortingOrder;
            return tilemap;
        }

        private static void PaintHorizontal(Tilemap tilemap, TileBase tile, int startX, int endX, int y)
        {
            for (var x = startX; x <= endX; x++)
                tilemap.SetTile(new Vector3Int(x, y, 0), tile);
        }

        private static void PaintVertical(Tilemap tilemap, TileBase tile, int height, int x)
        {
            for (var y = 0; y < height; y++)
                tilemap.SetTile(new Vector3Int(x, y, 0), tile);
        }

        private static Tile CreateCollisionTile()
        {
            var path = SceneTileRoot + "/collision_blocked.asset";
            var tile = AssetDatabase.LoadAssetAtPath<Tile>(path);
            if (tile != null)
                return tile;
            tile = ScriptableObject.CreateInstance<Tile>();
            tile.name = "collision_blocked";
            tile.colliderType = Tile.ColliderType.Grid;
            AssetDatabase.CreateAsset(tile, path);
            return tile;
        }

        private static int CountCells(Tilemap tilemap)
        {
            var count = 0;
            foreach (var position in tilemap.cellBounds.allPositionsWithin)
            {
                if (tilemap.HasTile(position))
                    count++;
            }
            return count;
        }

        private static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
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
