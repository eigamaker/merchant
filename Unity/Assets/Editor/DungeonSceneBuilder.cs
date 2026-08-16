#if UNITY_EDITOR
using System.Collections.Generic;
using System.Linq;
using Merchan.Unity;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Merchan.Unity.Editor
{
    /// <summary>
    /// Creates the dungeon scene from code, the same way the town scene is built.
    /// Hand-editing scene YAML is unreviewable and easy to corrupt; a menu command
    /// keeps the scene reproducible and its contents visible in a diff.
    /// </summary>
    public static class DungeonSceneBuilder
    {
        private const string ScenePath = "Assets/Scenes/Dungeon.unity";

        [MenuItem("Merchan/Build Dungeon Scene")]
        public static void Build()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var camera = new GameObject("Main Camera") { tag = "MainCamera" };
            var lens = camera.AddComponent<Camera>();
            lens.orthographic = true;
            lens.orthographicSize = 9f;
            lens.clearFlags = CameraClearFlags.SolidColor;
            lens.backgroundColor = new Color(0.05f, 0.05f, 0.07f);
            camera.transform.position = new Vector3(0f, 0f, -10f);

            // The controller builds the floor, the party and the enemies at run
            // time from the authored layout, so the saved scene stays tiny. Only
            // the art references are baked in here, where AssetDatabase can reach
            // prefabs that live outside Resources.
            var controller = new GameObject("Dungeon").AddComponent<DungeonSceneController>();
            WireArt(controller);

            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            AddToBuildSettings();

            Debug.Log($"Built {ScenePath}. Press Play to walk the floor.");
        }

        /// <summary>
        /// Points the controller at the imported Craftpix prefabs. The escort uses
        /// a different swordsman tier from the merchant so the two are tellable
        /// apart at a glance on the grid.
        /// </summary>
        private static void WireArt(DungeonSceneController controller)
        {
            var serialized = new SerializedObject(controller);
            serialized.FindProperty("playerPrefab").objectReferenceValue = Load("Assets/Prefabs/Player/Craftpix/Swordsman_lvl1.prefab");
            serialized.FindProperty("guardPrefab").objectReferenceValue = Load("Assets/Prefabs/NPCs/Craftpix/Swordsman_lvl2.prefab");

            var enemies = serialized.FindProperty("enemyPrefabs");
            var ids = new List<string> { "Slime1", "Plant1", "Orc1", "Vampires1" };
            enemies.arraySize = ids.Count;
            for (var i = 0; i < ids.Count; i++)
            {
                var entry = enemies.GetArrayElementAtIndex(i);
                entry.FindPropertyRelative("EnemyId").stringValue = ids[i];
                entry.FindPropertyRelative("Prefab").objectReferenceValue = Load($"Assets/Prefabs/Enemies/Craftpix/{ids[i]}.prefab");
            }

            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static GameObject Load(string path)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) Debug.LogWarning($"Missing actor prefab: {path}. Run Merchan/Import Character Packs.");
            return prefab;
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
