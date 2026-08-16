using System.Collections.Generic;
using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The acceptance condition for the shop slice, end to end: a thing pulled out
    /// of a body underground is the thing that appears on the shelf, the thing a
    /// customer carries to the counter, and the thing that lands in the sold
    /// archive — one ItemInstance the whole way, never copied and never replaced.
    /// </summary>
    public sealed class FullCycleTests
    {
        private const string Prize = "blue-gem";

        private ItemCatalog catalog;
        private ItemLedger ledger;
        private InventoryState inventory;
        private QuickSlotService quickSlots;
        private InventoryService items;
        private GameState state;
        private LootService loot;
        private SalesService sales;
        private ShopSimulation simulation;
        private ShopActionResolver shopActions;
        private GameFlowService flow;
        private ShopLayout layout;
        private ShopState shop;
        private CustomerDefinition jeweler;

        [SetUp]
        public void SetUp()
        {
            catalog = StarterContent.Items();
            ledger = new ItemLedger();
            inventory = new InventoryState();
            quickSlots = new QuickSlotService(ledger, inventory, catalog);
            items = new InventoryService(ledger, inventory, catalog, quickSlots);
            state = new GameState(ledger, inventory);

            // A table that always pays out, so this test is about the journey
            // rather than about a loot roll.
            var tables = new LootTableCatalog(new[]
            {
                new LootTableDefinition("guaranteed", new[] { new LootTableEntry(Prize, 1) })
            });

            loot = new LootService(ledger, tables, items, state);
            sales = new SalesService(ledger, catalog, items, state);
            jeweler = StarterContent.Customers().Single(c => c.Id == "jeweler");
            simulation = new ShopSimulation(ledger, items, sales, state, new[] { jeweler });
            shopActions = new ShopActionResolver(state, ledger, items, quickSlots, catalog, sales, simulation);
            flow = new GameFlowService(state, ledger, items, catalog);

            var world = new ShopTestWorld();
            layout = world.Layout;
            shop = new ShopState(4242);
        }

        [Test]
        public void AFindTravelsFromABodyUndergroundToTheSoldArchive()
        {
            // --- underground -------------------------------------------------
            Assert.That(flow.TryDepart(), Is.True);

            var map = GridMap.FromRows(new[] { "#####", "#...#", "#####" }, new GridPos(1, 1), new GridPos(3, 1));
            var run = new DungeonRunState(map, 1, 1, new PlayerActor(new GridPos(1, 1)));
            var playerActions = new PlayerActionResolver(state, ledger, items, quickSlots, catalog, loot);
            var turns = new DungeonTurnResolver(playerActions, new GuardBrain(loot), new EnemyBrain());

            var definition = new EnemyDefinition("husk", "抜け殻", 1, 1, 0, StarterContent.RootedInPlace, "guaranteed");
            var enemy = new EnemyActor("husk-1", definition, new GridPos(2, 1));
            run.Enemies.Add(enemy);

            enemy.Hp = 0;
            var events = new List<DungeonEvent>();
            loot.DefeatEnemy(run, enemy, events);

            var prize = loot.Contents(run.Containers[0]).Single();
            Assert.That(prize.DefinitionId, Is.EqualTo(Prize));
            var prizeUuid = prize.Uuid;

            run.Player.Facing = Facing.Right;
            Assert.That(turns.Execute(run, state, DungeonCommand.Context()).ConsumedTurn, Is.True, "searching costs a turn");
            Assert.That(turns.Execute(run, state, DungeonCommand.Context()).ConsumedTurn, Is.True, "and so does taking");
            Assert.That(prize.Location, Is.EqualTo(ItemLocation.InPlayerBag()));

            // --- home --------------------------------------------------------
            flow.Return(RunOutcome.Returned);
            Assert.That(state.Day, Is.EqualTo(1), "walking home does not end the day");

            quickSlots.TryAssign(0, prizeUuid);
            quickSlots.Select(0);
            var display = shopActions.Actions(layout, shop, layout.Shelves[0].AccessCell, Facing.Up)
                .First(a => a.Kind == ShopActionKind.DisplayOnShelf);
            Assert.That(shopActions.Execute(layout, shop, display).Success, Is.True);
            Assert.That(prize.Location.Place, Is.EqualTo(ItemPlace.ShelfSlot));

            // --- trading -----------------------------------------------------
            simulation.Open(shop);
            var visit = new CustomerVisit("visit-1", jeweler, layout.CustomerEntrance);
            shop.Customers.Add(visit);
            shop.VisitsToday++;

            for (var tick = 0; tick < 600 && visit.Phase != CustomerPhase.AtCounter; tick++)
                simulation.Tick(shop, layout);

            Assert.That(visit.Phase, Is.EqualTo(CustomerPhase.AtCounter), "the jeweler never reached the counter");
            Assert.That(visit.HeldItemUuid, Is.EqualTo(prizeUuid), "they are carrying the very piece that was found");

            var goldBefore = state.Gold;
            var serve = shopActions.Actions(layout, shop, layout.ClerkCell, Facing.Down)
                .First(a => a.Kind == ShopActionKind.ServeCustomer);
            Assert.That(shopActions.Execute(layout, shop, serve).Success, Is.True);

            // --- the ledger --------------------------------------------------
            Assert.That(prize.Location, Is.EqualTo(ItemLocation.Sold()));
            Assert.That(ledger.Get(prizeUuid), Is.SameAs(prize), "one instance the whole way");
            Assert.That(state.Gold, Is.GreaterThan(goldBefore));
            Assert.That(sales.Sales.Single().ItemUuid, Is.EqualTo(prizeUuid));
            Assert.That(prize.DiscoveredFloor, Is.EqualTo(1), "the archive still knows where it came from");
            Assert.That(prize.History.Any(e => e.Kind == LedgerEntryKind.Sold), Is.True);

            // --- closing up --------------------------------------------------
            simulation.BeginClosing(shop);
            for (var tick = 0; tick < 600 && shop.Phase != ShopPhase.Closed; tick++)
                simulation.Tick(shop, layout);

            Assert.That(flow.TryFinishTradingDay(shop), Is.True);
            Assert.That(state.Day, Is.EqualTo(2), "shutting the door is what ends the day");
            Assert.That(flow.CanDepart, Is.True, "and frees tomorrow's expedition");
        }

        [Test]
        public void TheWholeCycleReloadsExactlyWhereItLeftOff()
        {
            flow.TryDepart();
            var prize = ledger.Create(Prize, state.Day, 2, ItemLocation.InPlayerBag());
            flow.Return(RunOutcome.Returned);
            items.TryMove(prize.Uuid, ItemLocation.OnShelf(layout.Shelves[0].Id, 2));

            var restored = SaveMapper.Restore(SaveMapper.Capture(state));
            var reloaded = restored.Items.OnShelfSlot(layout.Shelves[0].Id, 2);

            Assert.That(reloaded, Is.Not.Null, "the shelf should still be stocked");
            Assert.That(reloaded.Uuid, Is.EqualTo(prize.Uuid));
            Assert.That(reloaded.DiscoveredFloor, Is.EqualTo(2));
            Assert.That(restored.ExpeditionUsedToday, Is.True);
        }
    }
}
