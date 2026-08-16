using System.Collections.Generic;
using Merchan.Domain;
using UnityEngine;

namespace Merchan.Unity
{
    /// <summary>
    /// Runs the home shop. The merchant walks freely; customers arrive, browse,
    /// queue and pay on a fixed tick.
    ///
    /// Like the dungeon controller this holds no rules — it feeds
    /// <see cref="ShopSimulation"/> a tick at a time and asks
    /// <see cref="ShopActionResolver"/> what `E` means here.
    /// </summary>
    public sealed class HomeShopSceneController : MonoBehaviour
    {
        [SerializeField] private int roomWidth = 14;
        [SerializeField] private int roomHeight = 10;
        [SerializeField] private int seed = 20260816;
        [SerializeField] private GameObject merchantPrefab;
        [SerializeField] private GameObject customerPrefab;

        private MerchanInput input;
        private GameState state;
        private ShopState shop;
        private ShopLayout layout;
        private ShopSimulation simulation;
        private ShopActionResolver actions;
        private QuickSlotService quickSlots;
        private ItemCatalog catalog;
        private ItemLedger ledger;
        private GameFlowService flow;

        private GridActorView merchantView;
        private GridPos merchantCell;
        private Facing facing = Facing.Down;
        private readonly Dictionary<string, GridActorView> customerViews = new Dictionary<string, GridActorView>();
        private readonly Dictionary<string, GameObject> wareViews = new Dictionary<string, GameObject>();
        private float tickAccumulator;
        private string notice = "";

        private void Awake()
        {
            // Borrowed from the session, never rebuilt: everything the merchant
            // carried home has to still be here.
            var session = MerchanSession.Instance;
            catalog = session.Catalog;
            ledger = session.Ledger;
            quickSlots = session.QuickSlots;
            state = session.State;
            state.Mode = GameMode.HomeShopClosed;
            flow = session.Flow;

            simulation = new ShopSimulation(ledger, session.Items, session.Sales, state, StarterContent.Customers());
            actions = new ShopActionResolver(state, ledger, session.Items, quickSlots, catalog, session.Sales, simulation);

            layout = ShopLayoutBuilder.Build(transform, roomWidth, roomHeight, out var problems);
            if (layout == null)
            {
                Debug.LogError($"The shop is not built: {string.Join("; ", problems)}");
                return;
            }

            // A shop that fails validation still loads and simply does not work, so
            // it is worth being loud rather than letting a tester wonder why the
            // customers stand still.
            foreach (var problem in problems) Debug.LogError($"Shop layout: {problem}");

            shop = new ShopState(seed + state.Day);
            BuildRoomVisuals();

            merchantCell = layout.ClerkCell;
            merchantView = Spawn(merchantPrefab, "Merchant", merchantCell, new Color(0.4f, 0.7f, 1f));
            BuildCamera();

            input = new MerchanInput();
            notice = MerchanSession.Instance.ConsumeArrivalNotice()
                ?? "WASD/矢印で移動。E:調べる（棚・保管庫・カウンター・出口）";
        }

        private void Update()
        {
            if (layout == null || input == null) return;

            HandleMovement();
            HandleQuickSlots();
            AdvanceSimulation();
            SyncViews();
            FollowMerchant();
        }

        private void HandleMovement()
        {
            var command = input.Next(acceptMovement: true);
            if (!command.HasValue) return;

            if (command.Value.Kind == DungeonCommandKind.Context)
            {
                PerformContext();
                return;
            }

            if (command.Value.Kind != DungeonCommandKind.Move) return;

            facing = FacingExtensions.FromStep(command.Value.Direction, facing);
            var next = merchantCell + command.Value.Direction;
            if (!layout.Floor.CanTraverse(merchantCell, next)) return;

            merchantCell = next;
            merchantView.StepTo(merchantCell);
        }

        private void HandleQuickSlots()
        {
            var cycle = input.SlotCycleThisFrame();
            if (cycle != 0) quickSlots.SelectRelative(cycle);

            var slot = input.SlotKeyThisFrame();
            if (slot >= 0) quickSlots.Select(slot);
        }

        private void PerformContext()
        {
            var candidates = actions.Actions(layout, shop, merchantCell, facing);
            if (candidates.Count == 0)
            {
                notice = "ここには何もない。";
                return;
            }

            var result = actions.Execute(layout, shop, candidates[0]);
            notice = result.Message;

            if (candidates[0].Kind != ShopActionKind.LeaveForDungeon || !result.Success) return;

            // Nobody sensible walks down there alone, so signing whoever is
            // available is the default. Choosing between escorts is a menu the
            // vertical slice does not need yet.
            var session = MerchanSession.Instance;
            if (session.State.HiredGuardId == null)
            {
                foreach (var guard in session.Guards.Definitions)
                    if (session.Guards.TryHire(guard.Id))
                        break;
            }

            session.DepartForDungeon();
        }

        /// <summary>
        /// Advances the shop in whole ticks. Accumulating leftover time rather than
        /// scaling by the frame keeps a customer's walking speed and patience the
        /// same on any machine, and identical to what the tests measured.
        /// </summary>
        private void AdvanceSimulation()
        {
            if (!shop.IsTrading) return;

            tickAccumulator += Time.deltaTime;
            while (tickAccumulator >= ShopSimulation.TickSeconds)
            {
                tickAccumulator -= ShopSimulation.TickSeconds;
                simulation.Tick(shop, layout);
            }

            if (shop.Phase != ShopPhase.Closed || !flow.TryFinishTradingDay(shop)) return;

            notice = $"閉店。{state.Day}日目になった。";
            MerchanSession.Instance.Save();
        }

        private void SyncViews()
        {
            foreach (var visit in shop.Customers)
            {
                if (!customerViews.TryGetValue(visit.Id, out var view))
                {
                    view = Spawn(customerPrefab, visit.Definition.Name, visit.Position, new Color(1f, 0.8f, 0.5f));
                    customerViews[visit.Id] = view;
                }

                if (ShopAuthoringUtility.ToCell(view.transform.position) != visit.Position) view.StepTo(visit.Position);
            }

            foreach (var id in new List<string>(customerViews.Keys))
            {
                if (shop.CustomerById(id) != null) continue;
                Destroy(customerViews[id].gameObject);
                customerViews.Remove(id);
            }

            SyncWares();
        }

        /// <summary>Draws the physical wares sitting on the shelves. Customers pick
        /// the actual instance, so what is on screen is what is for sale.</summary>
        private void SyncWares()
        {
            var seen = new HashSet<string>();
            foreach (var shelf in layout.Shelves)
            for (var slot = 0; slot < shelf.SlotCount; slot++)
            {
                var item = ledger.OnShelfSlot(shelf.Id, slot);
                if (item == null) continue;

                seen.Add(item.Uuid);
                if (wareViews.ContainsKey(item.Uuid)) continue;

                var marker = new GameObject($"Ware {item.DefinitionId}");
                marker.transform.position = GridActorView.ToWorld(shelf.SlotCells[slot]) + new Vector3(0f, 0.15f, 0f);
                var sprite = marker.AddComponent<SpriteRenderer>();
                sprite.sprite = Swatch(new Color(0.95f, 0.85f, 0.4f));
                sprite.transform.localScale = Vector3.one * 0.5f;
                sprite.sortingOrder = 50;
                wareViews[item.Uuid] = marker;
            }

            foreach (var uuid in new List<string>(wareViews.Keys))
            {
                if (seen.Contains(uuid)) continue;
                Destroy(wareViews[uuid]);
                wareViews.Remove(uuid);
            }
        }

        private void BuildRoomVisuals()
        {
            var floorSprite = Swatch(new Color(0.30f, 0.26f, 0.22f));
            var wallSprite = Swatch(new Color(0.15f, 0.12f, 0.11f));
            var root = new GameObject("Room").transform;

            for (var y = 0; y < roomHeight; y++)
            for (var x = 0; x < roomWidth; x++)
            {
                var cell = new GridPos(x, y);
                var tile = new GameObject($"{x},{y}");
                tile.transform.SetParent(root);
                tile.transform.position = GridActorView.ToWorld(cell);
                var sprite = tile.AddComponent<SpriteRenderer>();
                sprite.sprite = layout.Floor.IsWalkable(cell) ? floorSprite : wallSprite;
                sprite.sortingOrder = -100;
            }

            Mark(layout.ClerkCell, new Color(0.9f, 0.7f, 0.3f));
            Mark(layout.StorageCell, new Color(0.5f, 0.4f, 0.8f));
            Mark(layout.DungeonExit, new Color(0.3f, 0.6f, 0.9f));
            Mark(layout.CustomerEntrance, new Color(0.4f, 0.9f, 0.5f));
            foreach (var cell in layout.QueueCells) Mark(cell, new Color(0.6f, 0.6f, 0.6f));
        }

        private void Mark(GridPos cell, Color colour)
        {
            var marker = new GameObject($"Mark {cell}");
            marker.transform.position = GridActorView.ToWorld(cell);
            var sprite = marker.AddComponent<SpriteRenderer>();
            sprite.sprite = Swatch(colour);
            sprite.transform.localScale = Vector3.one * 0.7f;
            sprite.sortingOrder = -90;
        }

        private GridActorView Spawn(GameObject prefab, string name, GridPos cell, Color fallback)
        {
            var instance = prefab != null ? Instantiate(prefab) : new GameObject();
            instance.name = name;
            if (prefab == null) instance.AddComponent<SpriteRenderer>().sprite = Swatch(fallback);

            var view = instance.GetComponent<GridActorView>() ?? instance.AddComponent<GridActorView>();
            view.Snap(cell);
            return view;
        }

        private static Sprite Swatch(Color colour)
        {
            var texture = new Texture2D(1, 1) { filterMode = FilterMode.Point };
            texture.SetPixel(0, 0, colour);
            texture.Apply();
            return Sprite.Create(texture, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
        }

        private void BuildCamera()
        {
            var camera = Camera.main;
            if (camera == null)
            {
                var holder = new GameObject("Main Camera") { tag = "MainCamera" };
                camera = holder.AddComponent<Camera>();
            }
            camera.orthographic = true;
            camera.orthographicSize = roomHeight * 0.6f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.05f, 0.05f, 0.07f);
            camera.transform.position = new Vector3(roomWidth * 0.5f, roomHeight * 0.5f, -10f);
        }

        private void FollowMerchant()
        {
            if (Camera.main == null || merchantView == null) return;
            var target = new Vector3(merchantView.transform.position.x, merchantView.transform.position.y, -10f);
            Camera.main.transform.position = Vector3.Lerp(Camera.main.transform.position, target, Time.deltaTime * 4f);
        }

        private void OnGUI()
        {
            if (layout == null) return;

            var style = new GUIStyle(GUI.skin.label) { fontSize = 15, normal = { textColor = Color.white }, wordWrap = true };
            GUI.Box(new Rect(10f, 10f, 640f, 104f), GUIContent.none);
            GUI.Label(new Rect(20f, 16f, 620f, 20f),
                $"{state.Day}日目   所持金 {state.Gold}G   {PhaseLabel()}   売上 {shop.TakingsToday}G / {shop.SalesToday}件", style);
            GUI.Label(new Rect(20f, 38f, 620f, 20f), $"手持ち: {HeldName()}   来店 {shop.VisitsToday}   未購入 {shop.WalkoutsToday}", style);
            GUI.Label(new Rect(20f, 60f, 620f, 20f), Prompt(), style);
            GUI.Label(new Rect(20f, 82f, 620f, 24f), notice, style);
        }

        private string PhaseLabel()
        {
            switch (shop.Phase)
            {
                case ShopPhase.Open: return "開店中";
                case ShopPhase.ClosingUp: return "閉店準備中";
                default: return "閉店中";
            }
        }

        private string HeldName()
        {
            var held = quickSlots.Held();
            if (held == null) return "なし";
            return catalog.TryGet(held.DefinitionId, out var definition) ? definition.NameFor(held.Knowledge) : held.DefinitionId;
        }

        private string Prompt()
        {
            var candidates = actions.Actions(layout, shop, merchantCell, facing);
            if (candidates.Count == 0) return "";

            var line = $"[{MerchanInput.KeyLabel(input.Context)}] {candidates[0].Label}";
            return candidates.Count > 1 ? $"{line}   (他 {candidates.Count - 1} 件)" : line;
        }

        private void OnDestroy()
        {
            input?.Dispose();
        }
    }
}
