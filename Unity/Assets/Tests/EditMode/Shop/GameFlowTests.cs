using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The day boundary, as confirmed: closing the shop ends the day, and one
    /// expedition is allowed per day. Coming home from the dungeon does not
    /// advance the calendar, so the trading that pays for the next trip cannot be
    /// skipped by accident.
    /// </summary>
    public sealed class GameFlowTests
    {
        private ShopTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new ShopTestWorld();
        }

        [Test]
        public void ReturningFromTheDungeonDoesNotAdvanceTheDay()
        {
            world.Flow.TryDepart();

            world.Flow.Return(RunOutcome.Returned);

            Assert.That(world.State.Day, Is.EqualTo(1));
            Assert.That(world.State.Mode, Is.EqualTo(GameMode.HomeShopClosed));
        }

        [Test]
        public void OnlyOneExpeditionPerDay()
        {
            Assert.That(world.Flow.TryDepart(), Is.True);
            world.Flow.Return(RunOutcome.Returned);

            Assert.That(world.Flow.TryDepart(), Is.False);
        }

        [Test]
        public void ClosingUpAdvancesTheDayAndFreesTomorrowsExpedition()
        {
            world.Flow.TryDepart();
            world.Flow.Return(RunOutcome.Returned);
            world.Simulation.Open(world.Shop);
            world.Admit(world.Collector);
            world.RunUntil(() => world.Shop.Customers.Count == 0);
            world.Simulation.BeginClosing(world.Shop);
            world.RunUntil(() => world.Shop.Phase == ShopPhase.Closed);

            Assert.That(world.Flow.TryFinishTradingDay(world.Shop), Is.True);

            Assert.That(world.State.Day, Is.EqualTo(2));
            Assert.That(world.Flow.CanDepart, Is.True);
            Assert.That(world.Shop.VisitsToday, Is.EqualTo(0), "the day's tally resets");
        }

        [Test]
        public void ADayWithNoTradingIsNotClosedByAccident()
        {
            Assert.That(world.Flow.TryFinishTradingDay(world.Shop), Is.False, "never opened, so there is nothing to close");
            Assert.That(world.State.Day, Is.EqualTo(1));
        }

        [Test]
        public void ExposureComesBackOvernight()
        {
            world.State.Hp = 3;

            world.Flow.EndDay();

            Assert.That(world.State.Hp, Is.EqualTo(world.State.MaxHp));
        }

        [Test]
        public void BeingRescuedCostsHalfTheOrdinaryHaulAndACutOfThePurse()
        {
            world.Flow.TryDepart();
            var cheap = world.Ledger.Create(ShopTestWorld.Herb, 1, 1, ItemLocation.InPlayerBag());
            var dear = world.Ledger.Create(ShopTestWorld.Gem, 1, 1, ItemLocation.InPlayerBag());
            world.State.Gold = 1000;

            var lost = world.Flow.Return(RunOutcome.Rescued);

            Assert.That(lost.Select(i => i.Uuid), Is.EqualTo(new[] { cheap.Uuid }), "the cheapest goes first");
            Assert.That(world.Ledger.Contains(dear.Uuid), Is.True);
            Assert.That(world.State.Gold, Is.EqualTo(900));
        }

        [Test]
        public void AOneOfAKindPieceIsNeverLostToARescue()
        {
            var world2 = new ShopTestWorld();
            var catalog = new ItemCatalog(new[]
            {
                new ItemDefinition("relic", ItemCategory.Relic, "像", "像", "像", 100, 1, unique: true),
                new ItemDefinition("junk", ItemCategory.Material, "がらくた", "がらくた", "がらくた", 10, 1)
            });
            var quickSlots = new QuickSlotService(world2.Ledger, world2.Inventory, catalog);
            var items = new InventoryService(world2.Ledger, world2.Inventory, catalog, quickSlots);
            var flow = new GameFlowService(world2.State, world2.Ledger, items, catalog);

            var unique = world2.Ledger.Create("relic", 1, 1, ItemLocation.InPlayerBag());
            world2.Ledger.Create("junk", 1, 1, ItemLocation.InPlayerBag());
            world2.Ledger.Create("junk", 1, 1, ItemLocation.InPlayerBag());

            flow.Return(RunOutcome.Rescued);

            Assert.That(world2.Ledger.Contains(unique.Uuid), Is.True, "losing a unique find to a dice roll reads as cheating");
        }

        [Test]
        public void ARescueEndsTheDayOnTheSpot()
        {
            world.Flow.TryDepart();

            world.Flow.Return(RunOutcome.Rescued);

            Assert.That(world.State.Day, Is.EqualTo(2), "there is no opening up after being carried home");
            Assert.That(world.State.Mode, Is.EqualTo(GameMode.HomeShopClosed));
        }

        [Test]
        public void TheWholeCycleSurvivesASaveAndReload()
        {
            world.Flow.TryDepart();
            var haul = world.Ledger.Create(ShopTestWorld.Gem, 1, 1, ItemLocation.InPlayerBag());
            world.Flow.Return(RunOutcome.Returned);
            world.Items.TryMove(haul.Uuid, ItemLocation.OnShelf(world.Shelf.Id, 1));

            var restored = SaveMapper.Restore(SaveMapper.Capture(world.State));

            Assert.That(restored.Day, Is.EqualTo(1));
            Assert.That(restored.ExpeditionUsedToday, Is.True, "reloading must not hand back a second expedition");
            Assert.That(restored.Items.OnShelfSlot(world.Shelf.Id, 1)?.Uuid, Is.EqualTo(haul.Uuid));
        }
    }
}
