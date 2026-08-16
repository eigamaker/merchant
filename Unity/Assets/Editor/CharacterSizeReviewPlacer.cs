using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Merchan.Unity.Editor
{
    /// <summary>
    /// Places every imported character prefab on the authored town map so the
    /// source cell scale can be reviewed in one scene. The generated root is
    /// deliberately named as a temporary review layer and can be deleted from
    /// the hierarchy without affecting the map or the prefabs.
    /// </summary>
    public static class CharacterSizeReviewPlacer
    {
        private const string ScenePath = "Assets/Scenes/TownAuthoring.unity";
        private const string ReviewRootName = "CharacterSizeReview__TEMP";

        private static readonly ReviewGroup[] Groups =
        {
            new ReviewGroup("PLAYER", "main character", "Assets/Prefabs/Player/Craftpix/Swordsman_lvl1.prefab", new[]
            {
                new Vector3(10.5f, 26.5f, -1f),
            }),
            new ReviewGroup("NPC", "villager / guard", null, new[]
            {
                new Vector3(17.5f, 26.5f, -1f),
                new Vector3(24.5f, 26.5f, -1f),
            }, new[]
            {
                "Assets/Prefabs/NPCs/Craftpix/Swordsman_lvl2.prefab",
                "Assets/Prefabs/NPCs/Craftpix/Swordsman_lvl3.prefab",
            }),
            new ReviewGroup("ENEMY", "all imported enemies", null, new[]
            {
                new Vector3(4.5f, 24.5f, -1f),
                new Vector3(11.5f, 24.5f, -1f),
                new Vector3(18.5f, 24.5f, -1f),
                new Vector3(25.5f, 24.5f, -1f),
                new Vector3(32.5f, 24.5f, -1f),
                new Vector3(39.5f, 24.5f, -1f),
                new Vector3(22.5f, 17.5f, -1f),
                new Vector3(29.5f, 17.5f, -1f),
                new Vector3(36.5f, 17.5f, -1f),
                new Vector3(43.5f, 17.5f, -1f),
                new Vector3(50.5f, 17.5f, -1f),
                new Vector3(57.5f, 17.5f, -1f),
                new Vector3(31.5f, 26.5f, -1f),
                new Vector3(38.5f, 26.5f, -1f),
                new Vector3(45.5f, 26.5f, -1f),
            }, new[]
            {
                "Assets/Prefabs/Enemies/Craftpix/Glassblower_Customer.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Glassblower_Seller.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Glassblower_Master.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Orc1.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Orc2.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Orc3.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Plant1.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Plant2.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Plant3.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Slime1.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Slime2.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Slime3.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Vampires1.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Vampires2.prefab",
                "Assets/Prefabs/Enemies/Craftpix/Vampires3.prefab",
            }),
        };

        [MenuItem("Merchan/Place Character Size Review")]
        public static void PlaceAll()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var previous = GameObject.Find(ReviewRootName);
            if (previous != null)
                UnityEngine.Object.DestroyImmediate(previous);

            var reviewRoot = new GameObject(ReviewRootName);
            SceneManager.MoveGameObjectToScene(reviewRoot, scene);
            var placed = 0;
            foreach (var group in Groups)
            {
                var groupRoot = new GameObject($"{group.name} — {group.label}");
                groupRoot.transform.SetParent(reviewRoot.transform, false);
                AddLabel(groupRoot.transform, group.positions[0] + Vector3.up * 1.7f, group.label);

                var prefabPaths = group.prefabPaths ?? new[] { group.singlePrefabPath };
                for (var index = 0; index < prefabPaths.Length; index++)
                {
                    var prefabPath = prefabPaths[index];
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                    if (prefab == null)
                    {
                        Debug.LogWarning($"[Merchan] Missing review prefab: {prefabPath}");
                        continue;
                    }

                    var instance = PrefabUtility.InstantiatePrefab(prefab, scene) as GameObject;
                    if (instance == null)
                        continue;
                    instance.name = $"{prefab.name} [size review]";
                    instance.transform.SetParent(groupRoot.transform, true);
                    instance.transform.position = group.positions[Mathf.Min(index, group.positions.Length - 1)];
                    placed++;
                }
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
            Debug.Log($"[Merchan] Placed {placed} character prefabs in {ScenePath} under {ReviewRootName}.");
        }

        private static void AddLabel(Transform parent, Vector3 position, string label)
        {
            var labelObject = new GameObject($"Label — {label}");
            labelObject.transform.SetParent(parent, true);
            labelObject.transform.position = position;
            var text = labelObject.AddComponent<TextMesh>();
            text.text = label;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.fontSize = 48;
            text.characterSize = 0.06f;
            text.color = Color.white;
            var renderer = labelObject.GetComponent<MeshRenderer>();
            renderer.sortingOrder = 100;
        }

        private sealed class ReviewGroup
        {
            public readonly string name;
            public readonly string label;
            public readonly string singlePrefabPath;
            public readonly Vector3[] positions;
            public readonly string[] prefabPaths;

            public ReviewGroup(string name, string label, string singlePrefabPath, Vector3[] positions, string[] prefabPaths = null)
            {
                this.name = name;
                this.label = label;
                this.singlePrefabPath = singlePrefabPath;
                this.positions = positions;
                this.prefabPaths = prefabPaths;
            }
        }
    }
}
