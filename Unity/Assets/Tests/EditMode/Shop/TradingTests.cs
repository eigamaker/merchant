using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The shop half of the loop, run in fixed ticks so a whole trading day takes
    /// no real time at all.
    ///
    /// The acceptance condition from the design doc is here: the very same
    /// ItemInstance the merchant put on a shelf is the one a customer carries to
    /// the counter and the one that ends up in the sold archive.
    /// </summary>
    public sealed class TradingTests
    {
        private ShopTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new ShopTestWorld();
        }

        [Test]
        public void AShopperCrossesTheRoomBuysAndLeaves()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Collector);

            Assert.That(world.RunUntil(() => visit.Phase == CustomerPhase.AtCounter), Is.True, "the shopper never reached the counter");
            Assert.That(gem.Location, Is.EqualTo(ItemLocation.HeldByCustomer(visit.Id)), "they should be carrying the gem");
            Assert.That(visit.Position, Is.EqualTo(world.Layout.CheckoutCell));

            var record = world.Simulation.Serve(world.Shop, visit);

            Assert.That(record, Is.Not.Null);
            Assert.That(gem.Location, Is.EqualTo(ItemLocation.Sold()), "the very same instance is archived");
            Assert.That(world.State.Gold, Is.EqualTo(300 + record.Price));

            Assert.That(world.RunUntil(() => !visit.IsPresent), Is.True, "the shopper never left");
            Assert.That(world.Shop.Customers, Is.Empty);
        }

        [Test]
        public void TheArchivedSaleRemembersWhoBoughtItAndForHowMuch()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Collector);
            world.RunUntil(() => visit.Phase == CustomerPhase.AtCounter);

            var record = world.Simulation.Serve(world.Shop, visit);

            Assert.That(world.Sales.Sales.Single(), Is.SameAs(record));
            Assert.That(record.CustomerId, Is.EqualTo(world.Collector.Id));
            Assert.That(gem.History.Any(entry => entry.Kind == LedgerEntryKind.Sold && entry.Value == record.Price), Is.True);
        }

        [Test]
        public void AShopperWhoWantsNothingTurnsAroundAtTheDoor()
        {
            world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Passerby);

            // One tick is the whole decision: they are standing on the doorway, so
            // turning around is already the way out.
            world.Run(1);

            Assert.That(visit.Phase, Is.EqualTo(CustomerPhase.Leaving));
            Assert.That(world.Shop.WalkoutsToday, Is.EqualTo(1));
            Assert.That(world.RunUntil(() => !visit.IsPresent), Is.True);
        }

        [Test]
        public void AShopperWhoCannotAffordItLeavesItOnTheShelf()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Pauper);

            world.Run(1);

            Assert.That(visit.Phase, Is.EqualTo(CustomerPhase.Leaving));
            Assert.That(gem.Location, Is.EqualTo(ItemLocation.OnShelf(world.Shelf.Id, 0)));
            Assert.That(gem.IsReserved, Is.False);
        }

        [Test]
        public void AnEmptyShopSendsEveryoneStraightBackOut()
        {
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Collector);

            Assert.That(world.RunUntil(() => !visit.IsPresent), Is.True);
            Assert.That(world.Shop.SalesToday, Is.EqualTo(0));
        }

        [Test]
        public void TwoShoppersNeverClaimTheSameWare()
        {
            world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var first = world.Admit(world.Collector);
            var second = world.Admit(world.Collector);

            // Both decide on the same tick, which is exactly the race the up-front
            // reservation exists to settle.
            world.Run(1);

            Assert.That(new[] { first, second }.Count(v => v.HeldItemUuid != null), Is.EqualTo(1));
            Assert.That(new[] { first, second }.Count(v => v.Phase == CustomerPhase.Leaving), Is.EqualTo(1),
                "the second shopper finds nothing left they want");
        }

        [Test]
        public void TwoShoppersWithTwoWaresBothQueueUp()
        {
            world.StockShelf(ShopTestWorld.Gem, 0);
            world.StockShelf(ShopTestWorld.Relic, 1);
            world.Simulation.Open(world.Shop);
            var first = world.Admit(world.Collector);
            var second = world.Admit(world.Collector);

            Assert.That(world.RunUntil(() => world.Shop.Queue.Count == 2), Is.True, "both should end up in the queue");
            Assert.That(first.HeldItemUuid, Is.Not.EqualTo(second.HeldItemUuid));
        }

        [Test]
        public void OnlyTheFrontOfTheQueueCanBeServed()
        {
            world.StockShelf(ShopTestWorld.Gem, 0);
            world.StockShelf(ShopTestWorld.Relic, 1);
            world.Simulation.Open(world.Shop);
            world.Admit(world.Collector);
            world.Admit(world.Collector);
            world.RunUntil(() => world.Shop.Queue.Count == 2 && world.Shop.AtCounter() != null);

            var second = world.Shop.CustomerById(world.Shop.Queue[1]);

            Assert.That(world.Simulation.Serve(world.Shop, second), Is.Null, "the one behind cannot be served first");
        }

        [Test]
        public void TheQueueClosesUpAfterASale()
        {
            world.StockShelf(ShopTestWorld.Gem, 0);
            world.StockShelf(ShopTestWorld.Relic, 1);
            world.Simulation.Open(world.Shop);
            world.Admit(world.Collector);
            world.Admit(world.Collector);
            world.RunUntil(() => world.Shop.Queue.Count == 2 && world.Shop.AtCounter() != null);

            world.Simulation.Serve(world.Shop, world.Shop.AtCounter());

            Assert.That(world.RunUntil(() => world.Shop.AtCounter() != null), Is.True, "the next shopper should move up");
            Assert.That(world.Shop.AtCounter().Position, Is.EqualTo(world.Layout.CheckoutCell));
        }

        [Test]
        public void AShopperWhoIsKeptWaitingPutsTheWareBack()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Impatient);

            Assert.That(world.RunUntil(() => !visit.IsPresent), Is.True, "an unserved shopper has to give up eventually");
            Assert.That(visit.Bought, Is.False);
            Assert.That(gem.Location, Is.EqualTo(ItemLocation.OnShelf(world.Shelf.Id, 0)), "the ware goes back where it came from");
            Assert.That(gem.IsReserved, Is.False, "and is available to the next shopper");
        }

        [Test]
        public void AnAbandonedWareGoesToStorageWhenItsSlotHasBeenRefilled()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem, 0);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Impatient);
            world.RunUntil(() => visit.HeldItemUuid == gem.Uuid);

            // The merchant restocks the empty slot while the shopper dithers.
            world.StockShelf(ShopTestWorld.Relic, 0);

            Assert.That(world.RunUntil(() => !visit.IsPresent), Is.True);
            Assert.That(gem.Location, Is.EqualTo(ItemLocation.InShopStorage()), "nothing may be lost on the way back");
        }

        [Test]
        public void NoWareIsEverLostAcrossAWholeTradingDay()
        {
            world.StockShelf(ShopTestWorld.Gem, 0);
            world.StockShelf(ShopTestWorld.Relic, 1);
            world.StockShelf(ShopTestWorld.Herb, 2);
            var before = world.Ledger.All.Count;

            world.Simulation.Open(world.Shop);
            for (var i = 0; i < 900; i++)
            {
                world.Simulation.Tick(world.Shop, world.Layout);
                var waiting = world.Shop.AtCounter();
                if (waiting != null) world.Simulation.Serve(world.Shop, waiting);
            }

            Assert.That(world.Ledger.All.Count, Is.EqualTo(before), "instances must not appear or vanish");
            foreach (var item in world.Ledger.All)
                Assert.That(item.Location.Place, Is.Not.EqualTo(ItemPlace.Nowhere), $"{item.Uuid} ended up nowhere");
        }

        [Test]
        public void ClosingStopsNewArrivalsButLetsTheRoomEmpty()
        {
            world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Collector);
            world.RunUntil(() => visit.Phase == CustomerPhase.AtCounter);

            world.Simulation.BeginClosing(world.Shop);
            Assert.That(world.Shop.Phase, Is.EqualTo(ShopPhase.ClosingUp));

            world.Simulation.Serve(world.Shop, visit);
            Assert.That(world.RunUntil(() => world.Shop.Phase == ShopPhase.Closed), Is.True,
                "trading should end once the last shopper is out");
            Assert.That(world.Shop.Customers, Is.Empty);
        }

        [Test]
        public void ShoppersArriveOnTheirOwnOnceTheShopIsOpen()
        {
            world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);

            Assert.That(world.RunUntil(() => world.Shop.VisitsToday > 0, maxTicks: 200), Is.True);
        }

        [Test]
        public void TheSameSeedReplaysTheSameTradingDay()
        {
            Assert.That(Replay(7), Is.EqualTo(Replay(7)));
            Assert.That(Replay(8), Is.Not.EqualTo(Replay(7)));
        }

        private static string Replay(int seed)
        {
            var run = new ShopTestWorld(seed);
            run.StockShelf(ShopTestWorld.Gem, 0);
            run.StockShelf(ShopTestWorld.Relic, 1);
            run.Simulation.Open(run.Shop);

            var trail = new System.Text.StringBuilder();
            for (var i = 0; i < 400; i++)
            {
                run.Simulation.Tick(run.Shop, run.Layout);
                var waiting = run.Shop.AtCounter();
                if (waiting != null) run.Simulation.Serve(run.Shop, waiting);
                trail.Append(run.Shop.Customers.Count).Append(run.Shop.SalesToday).Append('|');
            }
            return trail.ToString();
        }
    }
}
