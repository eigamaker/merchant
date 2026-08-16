using System.Collections.Generic;
using Merchan.Domain;
using Newtonsoft.Json;
using UnityEngine;

namespace Merchan.Unity
{
    /// <summary>
    /// Runs the dungeon: owns the domain state, turns key presses into commands,
    /// and replays the events a turn produced.
    ///
    /// It holds no rules of its own. Every decision — whether a command is legal,
    /// whether it costs a turn, what the escort does — belongs to
    /// <see cref="DungeonTurnResolver"/>. This class only asks and then draws.
    /// </summary>
    public sealed class DungeonSceneController : MonoBehaviour
    {
        [Tooltip("Layout under Resources/Merchan/Data, without the extension.")]
        [SerializeField] private string layoutResource = "Merchan/Data/dungeonFloor1";

        [SerializeField] private int seed = 20260816;

        // Wired by Merchan/Build Dungeon Scene. Direct references rather than
        // Resources.Load paths: the imported character prefabs live outside
        // Resources, and duplicating them there just to load them by string would
        // leave two copies to keep in step.
        [SerializeField] private GameObject playerPrefab;
        [SerializeField] private GameObject guardPrefab;
        [SerializeField] private ActorPrefab[] enemyPrefabs = new ActorPrefab[0];

        [System.Serializable]
        public sealed class ActorPrefab
        {
            public string EnemyId;
            public GameObject Prefab;
        }

        private MerchanInput input;
        private GameState state;
        private DungeonRunState run;
        private DungeonTurnResolver turns;
        private PlayerActionResolver playerActions;
        private QuickSlotService quickSlots;
        private ItemCatalog catalog;

        private readonly Dictionary<string, GridActorView> views = new Dictionary<string, GridActorView>();
        private readonly Queue<DungeonEvent> playback = new Queue<DungeonEvent>();
        private float nextEventAt;
        private string notice = "";

        private void Awake()
        {
            // The session owns the world; the scene only borrows it. Building a
            // fresh GameState here would quietly throw away whatever the merchant
            // walked in with.
            var session = MerchanSession.Instance;
            catalog = session.Catalog;
            quickSlots = session.QuickSlots;
            state = session.State;
            state.Mode = GameMode.Dungeon;

            var loot = new LootService(session.Ledger, StarterContent.LootTables(), session.Items, state);
            playerActions = new PlayerActionResolver(state, session.Ledger, session.Items, quickSlots, catalog, loot);
            turns = new DungeonTurnResolver(playerActions, new GuardBrain(loot), new EnemyBrain());

            var map = LoadMap();
            if (map == null) return;

            run = new DungeonRunState(map, seed + state.Day, 1, new PlayerActor(map.Entrance));
            SpawnParty();
            SpawnEnemies();
            BuildFloorVisuals(map);
            BuildCamera(map);

            input = new MerchanInput();
            notice = "WASD/矢印で移動。E:調べる R:押す F:手持ち C:消耗品 Space:待つ";
        }

        private GridMap LoadMap()
        {
            var asset = Resources.Load<TextAsset>(layoutResource);
            if (asset == null)
            {
                Debug.LogError($"Dungeon layout '{layoutResource}' is missing from Resources.");
                return null;
            }

            var layout = JsonConvert.DeserializeObject<AuthoredLayout>(asset.text);
            var map = GridMap.FromRows(layout.Collision, Flip(layout.Entry, layout.Height), Flip(layout.Stairs, layout.Height));

            // An authored floor whose stairs cannot be walked to is still playable,
            // just unfinishable. Say so loudly rather than letting a tester hunt.
            if (!map.ReachableFrom(map.Entrance).Contains(map.Stairs))
                Debug.LogError($"'{layoutResource}': the stairs cannot be reached from the entrance.");

            return map;
        }

        private static GridPos Flip(AuthoredPoint point, int height) => new GridPos(point.X, height - 1 - point.Y);

        /// <summary>
        /// Places the merchant, and the escort they signed a contract with. Setting
        /// out unescorted is allowed — it is simply much more dangerous.
        /// </summary>
        private void SpawnParty()
        {
            views["player"] = SpawnActor(playerPrefab, "Player", run.Player.Position);

            foreach (var beside in GridPos.Orthogonal)
            {
                var cell = run.Player.Position + beside;
                if (!run.CanStep(run.Player.Position, cell)) continue;

                var escort = MerchanSession.Instance.Guards.Muster(cell);
                if (escort == null) return;

                run.AssignGuard(escort);
                views[escort.Id] = SpawnActor(guardPrefab, escort.Name, cell);
                return;
            }
        }

        private GameObject EnemyPrefab(string enemyId)
        {
            foreach (var entry in enemyPrefabs)
                if (entry != null && entry.EnemyId == enemyId)
                    return entry.Prefab;
            return null;
        }

        /// <summary>
        /// Places enemies on reachable floor, deterministically from the run seed so
        /// a given seed always produces the same floor to test against.
        /// </summary>
        private void SpawnEnemies()
        {
            var reachable = new List<GridPos>(run.Map.ReachableFrom(run.Player.Position));
            reachable.Sort((a, b) => a.Y == b.Y ? a.X.CompareTo(b.X) : a.Y.CompareTo(b.Y));

            var rng = new Rng(seed);
            var definitions = StarterContent.Enemies();

            for (var i = 0; i < 6 && reachable.Count > 0; i++)
            {
                var definition = definitions[rng.Int(0, definitions.Count - 1)];
                var cell = reachable[rng.Int(0, reachable.Count - 1)];

                // Never within sight of the entrance: the first step into a floor
                // should not be an ambush.
                if (GridPos.Distance(cell, run.Player.Position) < 6 || run.IsOccupied(cell)) continue;

                var enemy = new EnemyActor($"{definition.Id}-{i}", definition, cell);
                run.Enemies.Add(enemy);
                views[enemy.Id] = SpawnActor(EnemyPrefab(definition.Id), definition.Name, cell);
            }
        }

        /// <summary>Falls back to a plain coloured square so a missing prefab shows
        /// up as an obvious placeholder instead of an invisible actor.</summary>
        private GridActorView SpawnActor(GameObject prefab, string name, GridPos cell)
        {
            var instance = prefab != null ? Instantiate(prefab) : new GameObject();
            instance.name = name;
            if (prefab == null) instance.AddComponent<SpriteRenderer>().sprite = Cell(new Color(0.9f, 0.3f, 0.4f));

            var view = instance.GetComponent<GridActorView>() ?? instance.AddComponent<GridActorView>();
            view.Snap(cell);
            return view;
        }

        /// <summary>
        /// Flat tinted cells rather than the Craftpix tile sheets. The vertical
        /// slice is about whether the turn loop and the direct controls feel right;
        /// dressing the floor first would only make that harder to judge.
        /// </summary>
        private void BuildFloorVisuals(GridMap map)
        {
            var floor = Cell(new Color(0.22f, 0.21f, 0.26f));
            var wall = Cell(new Color(0.09f, 0.09f, 0.12f));
            var root = new GameObject("Floor").transform;

            for (var y = 0; y < map.Height; y++)
            for (var x = 0; x < map.Width; x++)
            {
                var tile = new GameObject($"{x},{y}");
                tile.transform.SetParent(root);
                tile.transform.position = GridActorView.ToWorld(new GridPos(x, y));
                var sprite = tile.AddComponent<SpriteRenderer>();
                sprite.sprite = map.IsWalkable(new GridPos(x, y)) ? floor : wall;
                sprite.sortingOrder = -100;
            }

            var stairs = new GameObject("Stairs");
            stairs.transform.position = GridActorView.ToWorld(map.Stairs);
            var stairsSprite = stairs.AddComponent<SpriteRenderer>();
            stairsSprite.sprite = Cell(new Color(0.85f, 0.75f, 0.35f));
            stairsSprite.sortingOrder = -50;
        }

        private static Sprite Cell(Color color)
        {
            var texture = new Texture2D(1, 1) { filterMode = FilterMode.Point };
            texture.SetPixel(0, 0, color);
            texture.Apply();
            return Sprite.Create(texture, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
        }

        private void BuildCamera(GridMap map)
        {
            var camera = Camera.main;
            if (camera == null)
            {
                var holder = new GameObject("Main Camera") { tag = "MainCamera" };
                camera = holder.AddComponent<Camera>();
            }
            camera.orthographic = true;
            camera.orthographicSize = 9f;
            camera.backgroundColor = new Color(0.05f, 0.05f, 0.07f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.transform.position = GridActorView.ToWorld(map.Entrance) + new Vector3(0f, 0f, -10f);
        }

        private void Update()
        {
            if (run == null || input == null) return;

            FollowPlayer();
            if (DrainPlayback()) return;

            // Only head home once the last event has played, so the player sees the
            // blow that felled them rather than a sudden cut to the shop.
            if (run.Outcome.HasValue)
            {
                GoHome(run.Outcome.Value);
                return;
            }

            HandleFreeActions();

            var command = input.Next(acceptMovement: true);
            if (!command.HasValue) return;

            var result = turns.Execute(run, state, command.Value);
            foreach (var entry in result.Events) playback.Enqueue(entry);
            if (!result.ConsumedTurn) DrainPlayback();
        }

        private bool goingHome;

        private void GoHome(RunOutcome outcome)
        {
            if (goingHome) return;

            goingHome = true;
            input.Flush();
            MerchanSession.Instance.ReturnToShop(outcome, run.Guard != null, run.Floor);
        }

        /// <summary>Aiming and gear changes never reach the turn resolver, because
        /// they are not actions.</summary>
        private void HandleFreeActions()
        {
            var cycle = input.SlotCycleThisFrame();
            if (cycle != 0) quickSlots.SelectRelative(cycle);

            var slot = input.SlotKeyThisFrame();
            if (slot >= 0) quickSlots.Select(slot);
        }

        private void FollowPlayer()
        {
            if (Camera.main == null || !views.TryGetValue("player", out var view)) return;

            var target = view.transform.position + new Vector3(0f, 0f, -10f);
            Camera.main.transform.position = Vector3.Lerp(Camera.main.transform.position, target, Time.deltaTime * 6f);
        }

        /// <summary>
        /// Plays back one event at a time. Input is refused while the queue drains,
        /// so the player always sees what their last command did before the next
        /// one lands.
        /// </summary>
        private bool DrainPlayback()
        {
            if (playback.Count == 0) return false;
            if (Time.time < nextEventAt) return true;

            var entry = playback.Dequeue();
            nextEventAt = Time.time + 0.06f;

            switch (entry.Kind)
            {
                case DungeonEventKind.Move:
                case DungeonEventKind.Shove:
                    if (views.TryGetValue(MoverOf(entry), out var mover)) mover.StepTo(entry.To);
                    break;

                case DungeonEventKind.Attack:
                case DungeonEventKind.Intercepted:
                    if (views.TryGetValue(entry.ActorId, out var attacker)) attacker.PlayAttack();
                    if (views.TryGetValue(entry.TargetId, out var victim)) victim.PlayHurt();
                    notice = Describe(entry);
                    break;

                case DungeonEventKind.Defeated:
                    if (views.TryGetValue(entry.ActorId, out var fallen))
                    {
                        Destroy(fallen.gameObject);
                        views.Remove(entry.ActorId);
                    }
                    break;

                case DungeonEventKind.RemnantLeft:
                    ShowRemnant(entry);
                    break;

                default:
                    notice = Describe(entry);
                    break;
            }

            return true;
        }

        /// <summary>A shove moves the target, not the shover.</summary>
        private static string MoverOf(DungeonEvent entry) => entry.Kind == DungeonEventKind.Shove ? entry.TargetId : entry.ActorId;

        private void ShowRemnant(DungeonEvent entry)
        {
            var marker = new GameObject($"Remnant {entry.TargetId}");
            marker.transform.position = GridActorView.ToWorld(entry.To);
            var sprite = marker.AddComponent<SpriteRenderer>();
            sprite.sprite = Cell(new Color(0.55f, 0.25f, 0.25f));
            sprite.sortingOrder = -40;
            notice = "何かが残された。Eで探ろう。";
        }

        private string Describe(DungeonEvent entry)
        {
            switch (entry.Kind)
            {
                case DungeonEventKind.Attack: return $"{entry.ActorId} → {entry.TargetId} に{entry.Amount}ダメージ。";
                case DungeonEventKind.Intercepted: return $"護衛がかばった。{entry.Amount}ダメージ。";
                case DungeonEventKind.ShoveFailed: return "押し返せなかった。";
                case DungeonEventKind.Staggered: return "体勢を崩している。";
                case DungeonEventKind.ContainerSearched: return entry.Amount > 0 ? $"{entry.Amount}点見つけた。" : "何も持っていなかった。";
                case DungeonEventKind.ItemTaken: return "道具袋へ入れた。";
                case DungeonEventKind.TrapSprung: return $"罠が作動した。{entry.Amount}ダメージ。";
                case DungeonEventKind.Rescued: return "救助された。店へ運ばれる。";
                case DungeonEventKind.LeftDungeon: return "ダンジョンを出た。";
                default: return entry.Text ?? notice;
            }
        }

        private void OnGUI()
        {
            if (run == null) return;

            var style = new GUIStyle(GUI.skin.label) { fontSize = 16, normal = { textColor = Color.white }, wordWrap = true };
            GUI.Box(new Rect(10f, 10f, 620f, 96f), GUIContent.none);
            GUI.Label(new Rect(20f, 16f, 600f, 22f),
                $"体力 {state.Hp}/{state.MaxHp}   ターン {run.Turn}   手持ち: {HeldName()}", style);
            GUI.Label(new Rect(20f, 40f, 600f, 22f), Prompt(), style);
            GUI.Label(new Rect(20f, 64f, 600f, 36f), notice, style);
        }

        private string HeldName()
        {
            var held = quickSlots.Held();
            if (held == null) return "なし";
            return catalog.TryGet(held.DefinitionId, out var definition)
                ? $"{definition.NameFor(held.Knowledge)}{(held.Quantity > 1 ? $" x{held.Quantity}" : "")}"
                : held.DefinitionId;
        }

        /// <summary>
        /// The field prompt: what is in front, what `E` would do to it, and the key
        /// that is actually bound right now. Reading the binding live means a
        /// rebind is reflected here without touching this string.
        /// </summary>
        private string Prompt()
        {
            var actions = playerActions.ContextActions(run);
            if (actions.Count == 0) return "";

            var key = MerchanInput.KeyLabel(input.Context);
            var line = $"[{key}] {actions[0].Label}";
            return actions.Count > 1 ? $"{line}   (他 {actions.Count - 1} 件)" : line;
        }

        private void OnDestroy()
        {
            input?.Dispose();
        }

        /// <summary>The authored layout format shared with the browser edition:
        /// rows of characters, top-down, '#' for solid.</summary>
        private sealed class AuthoredLayout
        {
            public int Width;
            public int Height;
            public string[] Collision;
            public AuthoredPoint Entry;
            public AuthoredPoint Stairs;
        }

        private sealed class AuthoredPoint
        {
            public int X;
            public int Y;
        }
    }
}
