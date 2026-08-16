using System.Collections.Generic;
using Merchan.Domain;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// A small but complete shop: a door, one shelf of three slots, a storage
    /// chest, a counter and a three-deep queue.
    ///
    /// Shelf slots are drawn solid because a ware sits on furniture, not on the
    /// floor. All three sit within arm's reach of the one cell you stand in.
    ///
    /// <code>
    ///   y=4  # . S S S . . . #    S = shelf slot (solid)
    ///   y=3  # # . . A . . T #    A = shelf access, T = storage
    ///   y=2  # . . . . . . K #    K = where the merchant stands
    ///   y=1  # . . . . 3 2 1 #    1..3 = queue, 1 is served
    ///   y=0  # # # # D # # # #    D = door
    /// </code>
    ///
    /// (1,4) is deliberately sealed off by the wall below it — an unreachable
    /// corner to point the layout validator at.
    /// </summary>
    internal sealed class ShopTestWorld
    {
        public const string Relic = "stone-statue";
        public const string Gem = "blue-gem";
        public const string Herb = "herb";

        private static readonly string[] Room =
        {
            "##########",
            "#.###....#",
            "##.......#",
            "#........#",
            "#........#",
            "####.#####"
        };

        public ShopTestWorld(int seed = 99)
        {
            Catalog = new ItemCatalog(new[]
            {
                new ItemDefinition(Relic, ItemCategory.Relic, "小さな石像", "古代祭祀の像", "地下王朝の門番像", 600, 3),
                new ItemDefinition(Gem, ItemCategory.Gem, "青い宝石", "海色のサファイア", "深海王の涙", 400, 1),
                new ItemDefinition(Herb, ItemCategory.Material, "薬草", "傷薬になる薬草", "銀露草", 50, 1, stackable: true, maxStack: 10)
            });

            Ledger = new ItemLedger();
            Inventory = new InventoryState();
            QuickSlots = new QuickSlotService(Ledger, Inventory, Catalog);
            Items = new InventoryService(Ledger, Inventory, Catalog, QuickSlots);
            State = new GameState(Ledger, Inventory) { Mode = GameMode.HomeShopClosed };

            Sales = new SalesService(Ledger, Catalog, Items, State);

            Collector = new CustomerDefinition("collector", "サフィ", "宝石収集家",
                new[] { ItemCategory.Gem, ItemCategory.Relic }, budget: 5000, knowledge: new[] { ItemCategory.Gem });
            Passerby = new CustomerDefinition("passerby", "通行人", "冷やかし",
                new[] { ItemCategory.Book }, budget: 5000);
            Pauper = new CustomerDefinition("pauper", "見習い", "無一文",
                new[] { ItemCategory.Gem, ItemCategory.Relic }, budget: 10);
            Impatient = new CustomerDefinition("impatient", "急ぎの客", "行商",
                new[] { ItemCategory.Gem, ItemCategory.Relic }, budget: 5000, patienceTicks: 5, ticksPerStep: 0);

            Customers = new List<CustomerDefinition> { Collector };
            Simulation = new ShopSimulation(Ledger, Items, Sales, State, Customers);
            Actions = new ShopActionResolver(State, Ledger, Items, QuickSlots, Catalog, Sales, Simulation);
            Flow = new GameFlowService(State, Ledger, Items, Catalog);

            var floor = GridMap.FromRows(Room, new GridPos(4, 0), new GridPos(4, 0));
            var shelf = new ShelfFixture("shelf-a", new GridPos(3, 3), new[] { new GridPos(2, 4), new GridPos(3, 4), new GridPos(4, 4) });

            Layout = new ShopLayout(
                floor,
                customerEntrance: new GridPos(4, 0),
                dungeonExit: new GridPos(1, 2),
                storageCell: new GridPos(8, 3),
                clerkCell: new GridPos(8, 2),
                queueCells: new[] { new GridPos(8, 1), new GridPos(7, 1), new GridPos(6, 1) },
                shelves: new[] { shelf });

            Shop = new ShopState(seed);
        }

        public ItemCatalog Catalog { get; }

        public ItemLedger Ledger { get; }

        public InventoryState Inventory { get; }

        public QuickSlotService QuickSlots { get; }

        public InventoryService Items { get; }

        public GameState State { get; }

        public SalesService Sales { get; }

        public ShopSimulation Simulation { get; }

        public ShopActionResolver Actions { get; }

        public GameFlowService Flow { get; }

        public ShopLayout Layout { get; }

        public ShopState Shop { get; }

        public List<CustomerDefinition> Customers { get; }

        public CustomerDefinition Collector { get; }

        public CustomerDefinition Passerby { get; }

        public CustomerDefinition Pauper { get; }

        public CustomerDefinition Impatient { get; }

        public ShelfFixture Shelf => Layout.Shelves[0];

        public ItemInstance StockShelf(string definitionId, int slot = 0)
        {
            return Ledger.Create(definitionId, State.Day, 1, ItemLocation.OnShelf(Shelf.Id, slot));
        }

        public ItemInstance CarryInBag(string definitionId, int quantity = 1)
        {
            var item = Ledger.Create(definitionId, State.Day, 1, ItemLocation.InPlayerBag(), quantity);
            QuickSlots.TryAssign(0, item.Uuid);
            QuickSlots.Select(0);
            return item;
        }

        /// <summary>Drops a specific shopper at the door, bypassing the spawn timer
        /// so a test can be about one visit rather than about waiting.</summary>
        public CustomerVisit Admit(CustomerDefinition definition)
        {
            var visit = new CustomerVisit($"visit-{Shop.Customers.Count + 1}", definition, Layout.CustomerEntrance);
            Shop.Customers.Add(visit);
            Shop.VisitsToday++;
            return visit;
        }

        public void Run(int ticks)
        {
            for (var i = 0; i < ticks; i++) Simulation.Tick(Shop, Layout);
        }

        /// <summary>Ticks until the predicate holds, or gives up. Returns whether it
        /// happened, so a test can assert on it rather than on a tick count.</summary>
        public bool RunUntil(System.Func<bool> done, int maxTicks = 600)
        {
            for (var i = 0; i < maxTicks; i++)
            {
                if (done()) return true;
                Simulation.Tick(Shop, Layout);
            }
            return done();
        }

        public IReadOnlyList<ShopAction> PromptsAt(GridPos cell, Facing facing)
        {
            return Actions.Actions(Layout, Shop, cell, facing);
        }
    }
}
