using System.Collections.Generic;
using System.IO;
using Merchan.Domain;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Merchan.Unity
{
    /// <summary>
    /// The one long-lived object in the game: the ledger, the purse, the escorts
    /// and the calendar, kept alive across scene changes.
    ///
    /// Without this each scene would build its own world in Awake, and walking out
    /// of the shop would silently reset everything the expedition was for. Both
    /// scene controllers ask the session for their state instead of constructing
    /// one, so a find really does come home.
    ///
    /// This is also the only place that touches the disk. The domain assembly
    /// stays free of any JSON library; it only decides what is worth writing.
    /// </summary>
    public sealed class MerchanSession : MonoBehaviour
    {
        public const string HomeShopScene = "HomeShop";
        public const string DungeonScene = "Dungeon";

        private static MerchanSession instance;

        public static MerchanSession Instance
        {
            get
            {
                if (instance != null) return instance;

                instance = FindFirstObjectByType<MerchanSession>();
                if (instance != null) return instance;

                var holder = new GameObject("Merchan Session");
                instance = holder.AddComponent<MerchanSession>();
                return instance;
            }
        }

        public ItemCatalog Catalog { get; private set; }

        public ItemLedger Ledger { get; private set; }

        public InventoryState InventoryState { get; private set; }

        public QuickSlotService QuickSlots { get; private set; }

        public InventoryService Items { get; private set; }

        public GameState State { get; private set; }

        public GuardRoster Guards { get; private set; }

        public GameFlowService Flow { get; private set; }

        public SalesService Sales { get; private set; }

        /// <summary>How the last expedition ended, for the shop to report when the
        /// merchant arrives back. Cleared once shown.</summary>
        public RunOutcome? LastOutcome { get; private set; }

        public IReadOnlyList<ItemInstance> LastRescueLosses { get; private set; } = new ItemInstance[0];

        private static string SavePath => Path.Combine(Application.persistentDataPath, "save.json");

        private void Awake()
        {
            if (instance != null && instance != this)
            {
                Destroy(gameObject);
                return;
            }

            instance = this;
            DontDestroyOnLoad(gameObject);
            if (State == null) StartNewGame();
        }

        public void StartNewGame()
        {
            Catalog = StarterContent.Items();
            Ledger = new ItemLedger();
            InventoryState = new InventoryState();
            QuickSlots = new QuickSlotService(Ledger, InventoryState, Catalog);
            Items = new InventoryService(Ledger, InventoryState, Catalog, QuickSlots);
            State = new GameState(Ledger, InventoryState);
            Guards = new GuardRoster(State, StarterContent.Guards());
            Flow = new GameFlowService(State, Ledger, Items, Catalog);
            Sales = new SalesService(Ledger, Catalog, Items, State);

            GiveStartingKit();
        }

        /// <summary>
        /// Day one: a blade the merchant hopes not to use, something to break
        /// pursuit with, a way out, and two pieces to open the shop with.
        /// </summary>
        private void GiveStartingKit()
        {
            var dagger = Ledger.Create("notched-dagger", State.Day, null, ItemLocation.InPlayerBag());
            var smoke = Ledger.Create(StarterContent.SmokeBomb, State.Day, null, ItemLocation.InPlayerBag(), 2);
            var stone = Ledger.Create(StarterContent.ReturnStone, State.Day, null, ItemLocation.InPlayerBag());

            QuickSlots.TryAssign(0, dagger.Uuid);
            QuickSlots.TryAssign(1, smoke.Uuid);
            QuickSlots.TryAssign(2, stone.Uuid);
            QuickSlots.Select(0);
            QuickSlots.TrySetQuickConsumable(smoke.Uuid);

            foreach (var id in new[] { "blue-gem", "old-ring" })
                Ledger.Create(id, State.Day, 1, ItemLocation.InShopStorage());
        }

        /// <summary>
        /// Sets out. The escort under contract musters at the dungeon entrance, and
        /// the day's one expedition is spent here rather than on arriving back.
        /// </summary>
        public bool DepartForDungeon()
        {
            if (!Flow.TryDepart()) return false;

            LastOutcome = null;
            Save();
            SceneManager.LoadScene(DungeonScene);
            return true;
        }

        /// <summary>
        /// Comes home. Settling the escort's contract, the rescue losses and the
        /// day boundary all happen here so the shop scene only has to report them.
        /// </summary>
        public void ReturnToShop(RunOutcome outcome, bool escortSurvived, int floorsReached)
        {
            Guards.SettleExpedition(escortSurvived, floorsReached);
            LastRescueLosses = Flow.Return(outcome);
            LastOutcome = outcome;

            Save();
            SceneManager.LoadScene(HomeShopScene);
        }

        public string ConsumeArrivalNotice()
        {
            if (!LastOutcome.HasValue) return null;

            var notice = LastOutcome == RunOutcome.Rescued
                ? $"救助された。品物{LastRescueLosses.Count}点と救助費を失い、その日は店を開けられなかった。"
                : "帰還した。品を並べて店を開こう。";

            LastOutcome = null;
            LastRescueLosses = new ItemInstance[0];
            return notice;
        }

        public void Save()
        {
            try
            {
                File.WriteAllText(SavePath, JsonConvert.SerializeObject(SaveMapper.Capture(State, Guards), Formatting.Indented));
            }
            catch (IOException error)
            {
                // A failed write must not take the run down with it; the player
                // keeps playing and loses at most this checkpoint.
                Debug.LogWarning($"Could not write the save: {error.Message}");
            }
        }

        public bool TryLoad()
        {
            if (!File.Exists(SavePath)) return false;

            try
            {
                var save = JsonConvert.DeserializeObject<SaveGameV1>(File.ReadAllText(SavePath));
                if (save == null) return false;

                Catalog = StarterContent.Items();
                State = SaveMapper.Restore(save);
                Ledger = State.Items;
                InventoryState = State.Inventory;
                QuickSlots = new QuickSlotService(Ledger, InventoryState, Catalog);
                Items = new InventoryService(Ledger, InventoryState, Catalog, QuickSlots);
                Guards = new GuardRoster(State, StarterContent.Guards(), SaveMapper.RestoreGuards(save));
                Flow = new GameFlowService(State, Ledger, Items, Catalog);
                Sales = new SalesService(Ledger, Catalog, Items, State);
                return true;
            }
            catch (JsonException error)
            {
                Debug.LogError($"The save file could not be read, starting fresh: {error.Message}");
                return false;
            }
        }

        public void DeleteSave()
        {
            if (File.Exists(SavePath)) File.Delete(SavePath);
        }
    }
}
