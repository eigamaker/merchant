#if UNITY_EDITOR
using System.Linq;
using Merchan.Unity;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Merchan.Unity.Editor
{
    /// <summary>
    /// Lays out the home shop and saves it as a scene. Built from code for the
    /// same reason as the dungeon: hand-edited scene YAML is unreviewable, and a
    /// menu command keeps the room reproducible.
    ///
    /// The fixtures it places are ordinary components, so the room can be dragged
    /// around in the editor afterwards — the layout is read back from wherever the
    /// transforms actually end up.
    /// </summary>
    public static class HomeShopSceneBuilder
    {
        private const string ScenePath = "Assets/Scenes/HomeShop.unity";
        private const int RoomWidth = 14;
        private const int RoomHeight = 10;

        [MenuItem("Merchan/Build Home Shop Scene")]
        public static void Build()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var camera = new GameObject("Main Camera") { tag = "MainCamera" };
            var lens = camera.AddComponent<Camera>();
            lens.orthographic = true;
            lens.orthographicSize = RoomHeight * 0.6f;
            lens.clearFlags = CameraClearFlags.SolidColor;
            lens.backgroundColor = new Color(0.05f, 0.05f, 0.07f);
            camera.transform.position = new Vector3(RoomWidth * 0.5f, RoomHeight * 0.5f, -10f);

            var shop = new GameObject("HomeShop");
            var controller = shop.AddComponent<HomeShopSceneController>();

            //   The room is 14x10. Shelves sit against the top wall with their
            //   access row beneath, the counter is on the right, and the door is a
            //   gap in the bottom wall.
            BuildShelf(shop.transform, "shelf-a", new Vector2Int(3, 8), 3);
            BuildShelf(shop.transform, "shelf-b", new Vector2Int(8, 8), 3);

            Marker(shop.transform, "Door", new Vector2Int(6, 0), ShopMarkerKind.CustomerEntrance);
            Marker(shop.transform, "DungeonExit", new Vector2Int(1, 8), ShopMarkerKind.DungeonExit);
            Marker(shop.transform, "Storage", new Vector2Int(1, 2), ShopMarkerKind.Storage);
            Marker(shop.transform, "Counter", new Vector2Int(11, 4), ShopMarkerKind.Clerk);

            // The queue runs away from the counter, front first.
            Marker(shop.transform, "Queue0", new Vector2Int(11, 3), ShopMarkerKind.QueueSlot, 0);
            Marker(shop.transform, "Queue1", new Vector2Int(10, 3), ShopMarkerKind.QueueSlot, 1);
            Marker(shop.transform, "Queue2", new Vector2Int(9, 3), ShopMarkerKind.QueueSlot, 2);

            // The counter itself is furniture the merchant stands behind.
            Marker(shop.transform, "CounterTop", new Vector2Int(11, 5), ShopMarkerKind.Solid);
            Marker(shop.transform, "CounterTop2", new Vector2Int(12, 4), ShopMarkerKind.Solid);

            WireArt(controller);

            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            AddToBuildSettings();

            Debug.Log($"Built {ScenePath}. Press Play, walk to the counter and open up.");
        }

        /// <summary>A shelf: solid slot cells in a row, with the cell below them as
        /// the place a customer stands.</summary>
        private static void BuildShelf(Transform parent, string id, Vector2Int leftSlot, int slotCount)
        {
            var shelf = new GameObject($"Shelf {id}");
            shelf.transform.SetParent(parent);
            shelf.transform.position = Cell(leftSlot);

            var slots = new Transform[slotCount];
            for (var i = 0; i < slotCount; i++)
            {
                var slot = new GameObject($"Slot{i}");
                slot.transform.SetParent(shelf.transform);
                slot.transform.position = Cell(new Vector2Int(leftSlot.x + i, leftSlot.y));
                slots[i] = slot.transform;
            }

            // Centred under the row so every slot is within arm's reach.
            var access = new GameObject("Access");
            access.transform.SetParent(shelf.transform);
            access.transform.position = Cell(new Vector2Int(leftSlot.x + slotCount / 2, leftSlot.y - 1));

            var authoring = shelf.AddComponent<ShelfAuthoring>();
            var serialized = new SerializedObject(authoring);
            serialized.FindProperty("shelfId").stringValue = id;
            serialized.FindProperty("accessPoint").objectReferenceValue = access.transform;

            var slotsProperty = serialized.FindProperty("slots");
            slotsProperty.arraySize = slotCount;
            for (var i = 0; i < slotCount; i++)
                slotsProperty.GetArrayElementAtIndex(i).objectReferenceValue = slots[i];

            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void Marker(Transform parent, string name, Vector2Int cell, ShopMarkerKind kind, int order = 0)
        {
            var marker = new GameObject(name);
            marker.transform.SetParent(parent);
            marker.transform.position = Cell(cell);
            marker.AddComponent<ShopMarkerAuthoring>().Configure(kind, order);
        }

        private static Vector3 Cell(Vector2Int cell) => new Vector3(cell.x + 0.5f, cell.y + 0.5f, 0f);

        private static void WireArt(HomeShopSceneController controller)
        {
            var serialized = new SerializedObject(controller);
            serialized.FindProperty("merchantPrefab").objectReferenceValue =
                AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/Player/Craftpix/Swordsman_lvl1.prefab");
            // The glassblower pack ships a shopper and a shopkeeper, which is what
            // made it the pick for the shop's cast.
            serialized.FindProperty("customerPrefab").objectReferenceValue =
                AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/Enemies/Craftpix/Glassblower_Customer.prefab");
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void AddToBuildSettings()
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            if (scenes.Any(entry => entry.path == ScenePath)) return;

            scenes.Add(new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }
    }
}
#endif
