using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Merchan.Unity.Editor
{
    /// <summary>
    /// Imports the supplied Craftpix enemy character sheets without inventing
    /// extra frames.  Plant/Orc sheets are 64px directional frames; the
    /// Glassblower PNGs are 32px character composites made from Tiled's 2x2
    /// 16px cells and must therefore be sliced as 32px frames.
    /// </summary>
    public static class EnemyCharacterImporter
    {
        private const string ActorRoot = "Assets/Resources/Merchan/assets/actors/craftpix";
        private const string ClipRoot = "Assets/Animations/Enemies/Craftpix";
        private const string CharacterClipRoot = "Assets/Animations/Characters/Craftpix";
        private const string PrefabRoot = "Assets/Prefabs/Enemies/Craftpix";
        private const string PlayerPrefabRoot = "Assets/Prefabs/Player/Craftpix";
        private const string PlayerResourcePrefabRoot = "Assets/Resources/Merchan/Prefabs/Player/Craftpix";
        private const string NpcPrefabRoot = "Assets/Prefabs/NPCs/Craftpix";
        private const string CatalogPath = "Assets/Resources/Merchan/Data/enemyCharacterCatalog.json";
        private const string CharacterCatalogPath = "Assets/Resources/Merchan/Data/characterCatalog.json";

        private static readonly ActorSpec[] Specs =
        {
            new ActorSpec("Plant1", "predator-plants", "Plant1", 64, 64, 4, true, "Plant1"),
            new ActorSpec("Plant2", "predator-plants", "Plant2", 64, 64, 4, true, "Plant2"),
            new ActorSpec("Plant3", "predator-plants", "Plant3", 64, 64, 4, true, "Plant3"),
            new ActorSpec("Orc1", "orcs", "Orc1", 64, 64, 4, true, "orc1"),
            new ActorSpec("Orc2", "orcs", "Orc2", 64, 64, 4, true, "orc2"),
            new ActorSpec("Orc3", "orcs", "Orc3", 64, 64, 4, true, "orc3"),
            new ActorSpec("Slime1", "slimes", "Slime1", 64, 64, 4, true, "Slime1"),
            new ActorSpec("Slime2", "slimes", "Slime2", 64, 64, 4, true, "Slime2"),
            new ActorSpec("Slime3", "slimes", "Slime3", 64, 64, 4, true, "Slime3"),
            new ActorSpec("Vampires1", "vampires", "Vampires1", 64, 64, 4, true, "Vampires1"),
            new ActorSpec("Vampires2", "vampires", "Vampires2", 64, 64, 4, true, "Vampires2"),
            new ActorSpec("Vampires3", "vampires", "Vampires3", 64, 64, 4, true, "Vampires3"),
            new ActorSpec("Swordsman_lvl1", "swordsman", "Swordsman_lvl1", 64, 64, 4, true, "Swordsman_lvl1", "player", "main-character"),
            new ActorSpec("Swordsman_lvl2", "swordsman", "Swordsman_lvl2", 64, 64, 4, true, "Swordsman_lvl2", "npc", "villager"),
            new ActorSpec("Swordsman_lvl3", "swordsman", "Swordsman_lvl3", 64, 64, 4, true, "Swordsman_lvl3", "npc", "guard"),
            new ActorSpec("Glassblower_Customer", "glassblower-workshop", "Glassblower", 32, 32, 1, false, "Customer"),
            new ActorSpec("Glassblower_Seller", "glassblower-workshop", "Glassblower", 32, 32, 1, false, "Seller"),
            new ActorSpec("Glassblower_Master", "glassblower-workshop", "Glassblower", 32, 32, 15, false, "Master"),
        };

        [InitializeOnLoadMethod]
        private static void ImportOnFirstEditorLoad()
        {
            // The first import is intentionally automatic so a freshly opened
            // project cannot expose only loose PNG sheets. Once the generated
            // prefab exists, normal updates are explicit through the menu.
            EditorApplication.delayCall += () =>
            {
                // Force a disk refresh before checking the generated player;
                // this also catches a replacement sheet made outside Unity.
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                var swordsmanSheet = AssetDatabase.LoadAssetAtPath<Texture2D>(
                    $"{ActorRoot}/Swordsman_lvl1/Swordsman_lvl1_Idle_with_shadow.png");
                var swordsmanPrefabFile = ProjectAbsolutePath($"{PlayerPrefabRoot}/Swordsman_lvl1.prefab");
                if (AssetDatabase.LoadMainAssetAtPath($"{PrefabRoot}/Plant1.prefab") == null ||
                    AssetDatabase.LoadMainAssetAtPath($"{PlayerPrefabRoot}/Swordsman_lvl1.prefab") == null ||
                    !File.Exists(swordsmanPrefabFile) ||
                    swordsmanSheet == null)
                    ImportAll();
            };
        }

        [MenuItem("Merchan/Import Character Packs")]
        public static void ImportAll()
        {
            EnsureFolder("Assets/Animations");
            EnsureFolder("Assets/Animations/Enemies");
            EnsureFolder(ClipRoot);
            EnsureFolder("Assets/Animations/Characters");
            EnsureFolder(CharacterClipRoot);
            EnsureFolder("Assets/Prefabs");
            EnsureFolder("Assets/Prefabs/Enemies");
            EnsureFolder(PrefabRoot);
            EnsureFolder("Assets/Prefabs/Player");
            EnsureFolder(PlayerPrefabRoot);
            EnsureFolder("Assets/Resources/Merchan/Prefabs");
            EnsureFolder("Assets/Resources/Merchan/Prefabs/Player");
            EnsureFolder(PlayerResourcePrefabRoot);
            EnsureFolder("Assets/Prefabs/NPCs");
            EnsureFolder(NpcPrefabRoot);

            // Swordsman level 1 is the playable protagonist. The previous
            // merchant protagonist is intentionally not generated anymore.
            DeleteAssetIfExists($"{PlayerPrefabRoot}/MerchantProtagonist.prefab");
            DeleteAssetIfExists($"{PlayerResourcePrefabRoot}/MerchantProtagonist.prefab");
            DeleteAssetIfExists($"{NpcPrefabRoot}/Swordsman_lvl1.prefab");

            var enemyEntries = new List<CatalogEntry>();
            var characterEntries = new List<CatalogEntry>();
            foreach (var spec in Specs)
            {
                var entry = ImportActor(spec);
                if (entry != null)
                {
                    if (spec.role == "enemy")
                        enemyEntries.Add(entry);
                    else
                        characterEntries.Add(entry);
                }
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            WriteCatalog(enemyEntries, CatalogPath);
            WriteCatalog(characterEntries, CharacterCatalogPath);
            AssetDatabase.SaveAssets();
            Debug.Log($"[Merchan] Imported {enemyEntries.Count} enemy prefabs and {characterEntries.Count} player/NPC prefabs with source-named animation clips.");
        }

        // Keep the previous menu path working for existing editor workflows.
        [MenuItem("Merchan/Import Enemy Character Packs")]
        private static void ImportEnemyCharacterPacksLegacy()
        {
            ImportAll();
        }

        private static CatalogEntry ImportActor(ActorSpec spec)
        {
            var sourceDirectory = spec.id.StartsWith("Glassblower_", StringComparison.Ordinal)
                ? $"{ActorRoot}/Glassblower"
                : $"{ActorRoot}/{spec.folder}";
            var actionSheets = FindActionSheets(spec, sourceDirectory).ToList();
            var sourcePath = spec.directional
                ? actionSheets.FirstOrDefault().path
                : $"{sourceDirectory}/{spec.fileName}.png";
            if (string.IsNullOrEmpty(sourcePath))
            {
                Debug.LogWarning($"[Merchan] No action sheets found for {spec.id}");
                return null;
            }
            if (!File.Exists(ProjectAbsolutePath(sourcePath)))
            {
                Debug.LogWarning($"[Merchan] Missing enemy sheet: {sourcePath}");
                return null;
            }

            ConfigureTexture(sourcePath, spec);
            var sprites = AssetDatabase.LoadAllAssetsAtPath(sourcePath)
                .OfType<Sprite>()
                .ToDictionary(sprite => sprite.name, StringComparer.Ordinal);
            if (sprites.Count == 0)
            {
                Debug.LogWarning($"[Merchan] No sprites were produced for {sourcePath}");
                return null;
            }

            var clips = new List<ClipEntry>();
            foreach (var sheet in actionSheets)
            {
                var sheetPath = sheet.path;
                ConfigureTexture(sheetPath, spec);
                var sheetSprites = AssetDatabase.LoadAllAssetsAtPath(sheetPath)
                    .OfType<Sprite>()
                    .ToDictionary(sprite => sprite.name, StringComparer.Ordinal);
                clips.AddRange(CreateClips(spec, sheet, sheetSprites));
            }

            if (clips.Count == 0)
            {
                Debug.LogWarning($"[Merchan] No animation clips were produced for {spec.id}");
                return null;
            }

            var controllerPath = $"{spec.animationRoot}/{spec.id}.controller";
            DeleteAssetIfExists(controllerPath);
            var controller = AnimatorController.CreateAnimatorControllerAtPath(controllerPath);
            var stateMachine = controller.layers[0].stateMachine;
            AnimatorState defaultState = null;
            foreach (var clip in clips)
            {
                var state = stateMachine.AddState(clip.stateName);
                state.motion = AssetDatabase.LoadAssetAtPath<AnimationClip>(clip.assetPath);
                if (defaultState == null || clip.stateName == "idle-down" || clip.stateName == "idle-row00")
                    defaultState = state;
            }
            stateMachine.defaultState = defaultState;
            EditorUtility.SetDirty(controller);

            var prefabPath = $"{spec.prefabRoot}/{spec.id}.prefab";
            DeleteAssetIfExists(prefabPath);
            var root = new GameObject(spec.id);
            var renderer = root.AddComponent<SpriteRenderer>();
            renderer.sprite = sprites.Values.OrderBy(sprite => sprite.name, StringComparer.Ordinal).First();
            renderer.sortingOrder = 10;
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            var actorAnimator = root.AddComponent<Merchan.Unity.EnemyActorAnimator>();
            var serialized = new SerializedObject(actorAnimator);
            serialized.FindProperty("animator").objectReferenceValue = animator;
            serialized.FindProperty("defaultState").stringValue = defaultState == null ? clips[0].stateName : defaultState.name;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
            if (spec.role == "player")
            {
                DeleteAssetIfExists(spec.runtimePrefab);
                PrefabUtility.SaveAsPrefabAsset(root, spec.runtimePrefab);
            }
            UnityEngine.Object.DestroyImmediate(root);

            return new CatalogEntry
            {
                id = spec.id,
                pack = spec.pack,
                sourceSheet = sourcePath,
                sourceSheets = actionSheets.Select(sheet => sheet.path).ToArray(),
                prefab = prefabPath,
                runtimePrefab = spec.runtimePrefab,
                role = spec.role,
                usage = spec.usage,
                frameWidth = spec.frameWidth,
                frameHeight = spec.frameHeight,
                directions = spec.directional ? "down,left,right,up" : "row00..row" + (spec.rows - 1).ToString("00"),
                clips = clips.Select(clip => clip.stateName).ToArray(),
            };
        }

        private static IEnumerable<SheetSpec> FindActionSheets(ActorSpec spec, string sourceDirectory)
        {
            if (!spec.directional)
            {
                var path = $"{sourceDirectory}/{spec.fileName}.png";
                yield return new SheetSpec(path, "idle", 8, spec.rows > 1);
                yield break;
            }

            var files = Directory.GetFiles(ProjectAbsolutePath(sourceDirectory), "*.png")
                .Where(path => Path.GetFileName(path).Contains("with_shadow", StringComparison.OrdinalIgnoreCase))
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase);
            foreach (var absolute in files)
            {
                var file = Path.GetFileNameWithoutExtension(absolute);
                var action = file;
                var prefix = spec.fileName + "_";
                var prefixIndex = action.IndexOf(prefix, StringComparison.OrdinalIgnoreCase);
                if (prefixIndex >= 0)
                    action = action.Substring(prefixIndex + prefix.Length);
                var suffixIndex = action.IndexOf("_with_shadow", StringComparison.OrdinalIgnoreCase);
                if (suffixIndex >= 0)
                    action = action.Substring(0, suffixIndex);
                action = NormalizeActionName(action);
                yield return new SheetSpec(ToAssetPath(absolute), action, ActionFrameRate(action), false);
            }
        }

        private static IEnumerable<ClipEntry> CreateClips(ActorSpec spec, SheetSpec sheet, Dictionary<string, Sprite> sprites)
        {
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(sheet.path);
            var columns = Mathf.Max(1, texture.width / spec.frameWidth);
            var rows = Mathf.Max(1, texture.height / spec.frameHeight);
            var directions = spec.directional ? new[] { "down", "left", "right", "up" } : null;
            for (var row = 0; row < rows; row++)
            {
                var suffix = spec.directional ? directions[Mathf.Min(row, directions.Length - 1)] : $"row{row:00}";
                var stateName = $"{sheet.action}-{suffix}";
                var frameNames = Enumerable.Range(0, columns)
                    .Select(column => SpriteName(spec, sheet.action, row, column, spec.directional ? directions[Mathf.Min(row, directions.Length - 1)] : $"row{row:00}"))
                    .Where(sprites.ContainsKey)
                    .ToArray();
                if (frameNames.Length == 0)
                    continue;

                var clipPath = $"{spec.animationRoot}/{spec.id}_{sheet.action}_{suffix}.anim";
                DeleteAssetIfExists(clipPath);
                var clip = new AnimationClip
                {
                    name = $"{spec.id}_{sheet.action}_{suffix}",
                    frameRate = sheet.frameRate,
                    wrapMode = sheet.loop ? WrapMode.Loop : WrapMode.Once,
                };
                var keys = new ObjectReferenceKeyframe[frameNames.Length];
                for (var index = 0; index < frameNames.Length; index++)
                {
                    keys[index] = new ObjectReferenceKeyframe
                    {
                        time = index / sheet.frameRate,
                        value = sprites[frameNames[index]],
                    };
                }
                AnimationUtility.SetObjectReferenceCurve(clip, EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite"), keys);
                AssetDatabase.CreateAsset(clip, clipPath);
                yield return new ClipEntry(stateName, clipPath);
            }
        }

        private static void ConfigureTexture(string path, ActorSpec spec)
        {
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (importer == null || texture == null)
                return;

            var columns = Mathf.Max(1, texture.width / spec.frameWidth);
            var rows = Mathf.Max(1, texture.height / spec.frameHeight);
            var metadata = new List<SpriteMetaData>(columns * rows);
            for (var row = 0; row < rows; row++)
            for (var column = 0; column < columns; column++)
            {
                var direction = spec.directional
                    ? new[] { "down", "left", "right", "up" }[Mathf.Min(row, 3)]
                    : $"row{row:00}";
                metadata.Add(new SpriteMetaData
                {
                    name = SpriteName(spec, ActionFromPath(path, spec), row, column, direction),
                    rect = new Rect(column * spec.frameWidth, texture.height - ((row + 1) * spec.frameHeight), spec.frameWidth, spec.frameHeight),
                    alignment = (int)SpriteAlignment.Custom,
                    pivot = new Vector2(0.5f, 0.15f),
                });
            }

            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Multiple;
            // A 64px actor cell is four 16px town tiles, not two Unity units.
            // Importing at 16 PPU keeps actor pixels on the same grid as the
            // TownFree tilemap and avoids half-pixel resampling.
            importer.spritePixelsPerUnit = 16;
            importer.filterMode = FilterMode.Point;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.mipmapEnabled = false;
            importer.spritesheet = metadata.ToArray();
            importer.SaveAndReimport();
        }

        private static string ActionFromPath(string path, ActorSpec spec)
        {
            var file = Path.GetFileNameWithoutExtension(path);
            if (!spec.directional)
                return "idle";
            var prefix = spec.fileName + "_";
            var index = file.IndexOf(prefix, StringComparison.OrdinalIgnoreCase);
            var action = index >= 0 ? file.Substring(index + prefix.Length) : file;
            var suffix = action.IndexOf("_with_shadow", StringComparison.OrdinalIgnoreCase);
            if (suffix >= 0)
                action = action.Substring(0, suffix);
            return NormalizeActionName(action);
        }

        private static string NormalizeActionName(string value)
        {
            var action = value.Replace(" ", "_").ToLowerInvariant();
            while (action.Contains("__", StringComparison.Ordinal))
                action = action.Replace("__", "_", StringComparison.Ordinal);
            return action.Trim('_');
        }

        private static string SpriteName(ActorSpec spec, string action, int row, int column, string direction)
        {
            return $"{spec.id}_{action}_{direction}_{column:00}";
        }

        private static float ActionFrameRate(string action)
        {
            if (action.Contains("attack", StringComparison.Ordinal)) return 12f;
            if (action.Contains("run", StringComparison.Ordinal)) return 10f;
            if (action.Contains("walk", StringComparison.Ordinal)) return 8f;
            if (action.Contains("hurt", StringComparison.Ordinal)) return 8f;
            if (action.Contains("death", StringComparison.Ordinal)) return 8f;
            return 6f;
        }

        private static void WriteCatalog(List<CatalogEntry> entries, string catalogPath)
        {
            var absolute = ProjectAbsolutePath(catalogPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolute));
            File.WriteAllText(absolute, JsonUtility.ToJson(new Catalog { version = 1, actors = entries.ToArray() }, true) + "\n");
            AssetDatabase.ImportAsset(catalogPath, ImportAssetOptions.ForceUpdate);
        }

        private static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index++)
            {
                var next = $"{current}/{parts[index]}";
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }

        private static void DeleteAssetIfExists(string path)
        {
            if (AssetDatabase.LoadMainAssetAtPath(path) != null)
                AssetDatabase.DeleteAsset(path);
        }

        private static string ProjectAbsolutePath(string assetPath)
        {
            return Path.Combine(Directory.GetParent(Application.dataPath).FullName, assetPath.Replace('/', Path.DirectorySeparatorChar));
        }

        private static string ToAssetPath(string absolutePath)
        {
            var root = Directory.GetParent(Application.dataPath).FullName.Replace('\\', '/') + "/";
            return absolutePath.Replace('\\', '/').StartsWith(root, StringComparison.OrdinalIgnoreCase)
                ? absolutePath.Replace('\\', '/').Substring(root.Length)
                : absolutePath.Replace('\\', '/');
        }

        [Serializable]
        private sealed class ActorSpec
        {
            public readonly string id;
            public readonly string pack;
            public readonly string folder;
            public readonly int frameWidth;
            public readonly int frameHeight;
            public readonly int rows;
            public readonly bool directional;
            public readonly string fileName;
            public readonly string role;
            public readonly string usage;

            public string animationRoot => role == "enemy" ? ClipRoot : CharacterClipRoot;
            public string prefabRoot => role == "player" ? PlayerPrefabRoot : role == "npc" ? NpcPrefabRoot : PrefabRoot;
            public string runtimePrefab => role == "player" ? $"{PlayerResourcePrefabRoot}/{id}.prefab" : null;

            public ActorSpec(string id, string pack, string folder, int frameWidth, int frameHeight, int rows, bool directional, string fileName, string role = "enemy", string usage = "enemy")
            {
                this.id = id;
                this.pack = pack;
                this.folder = folder;
                this.frameWidth = frameWidth;
                this.frameHeight = frameHeight;
                this.rows = rows;
                this.directional = directional;
                this.fileName = fileName;
                this.role = role;
                this.usage = usage;
            }
        }

        private readonly struct SheetSpec
        {
            public readonly string path;
            public readonly string action;
            public readonly float frameRate;
            public readonly bool loop;

            public SheetSpec(string path, string action, float frameRate, bool loop)
            {
                this.path = path;
                this.action = action;
                this.frameRate = frameRate;
                this.loop = loop;
            }
        }

        private readonly struct ClipEntry
        {
            public readonly string stateName;
            public readonly string assetPath;

            public ClipEntry(string stateName, string assetPath)
            {
                this.stateName = stateName;
                this.assetPath = assetPath;
            }
        }

        [Serializable]
        private sealed class Catalog
        {
            public int version;
            public CatalogEntry[] actors;
        }

        [Serializable]
        private sealed class CatalogEntry
        {
            public string id;
            public string pack;
            public string sourceSheet;
            public string[] sourceSheets;
            public string prefab;
            public string runtimePrefab;
            public string role;
            public string usage;
            public int frameWidth;
            public int frameHeight;
            public string directions;
            public string[] clips;
        }
    }
}
