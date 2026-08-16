using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The merchant's side of the counter. Same contextual `E` as underground:
    /// face the thing and press one key, with no shared action menu in the way.
    /// </summary>
    public sealed class ShopActionTests
    {
        private ShopTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new ShopTestWorld();
        }

        private ShopActionResult Do(GridPos cell, Facing facing, ShopActionKind kind)
        {
            var action = world.PromptsAt(cell, facing).FirstOrDefault(a => a.Kind == kind);
            return world.Actions.Execute(world.Layout, world.Shop, action);
        }

        [Test]
        public void FacingAnEmptySlotWhileHoldingAWareOffersToDisplayIt()
        {
            var gem = world.CarryInBag(ShopTestWorld.Gem);

            var prompts = world.PromptsAt(world.Shelf.AccessCell, Facing.Up);

            Assert.That(prompts.Any(a => a.Kind == ShopActionKind.DisplayOnShelf), Is.True);
            Assert.That(prompts.First().Label, Does.Contain("並べる"));
            Assert.That(prompts.First().ItemUuid, Is.EqualTo(gem.Uuid));
        }

        [Test]
        public void DisplayingMovesTheWareOutOfTheBagAndOntoTheShelf()
        {
            var gem = world.CarryInBag(ShopTestWorld.Gem);

            var result = Do(world.Shelf.AccessCell, Facing.Up, ShopActionKind.DisplayOnShelf);

            Assert.That(result.Success, Is.True);
            Assert.That(gem.Location.Place, Is.EqualTo(ItemPlace.ShelfSlot));
            Assert.That(world.Ledger.InBag(), Is.Empty);
            Assert.That(world.QuickSlots.AtSlot(0), Is.Null, "the shortcut must not outlive the ware leaving the bag");
        }

        [Test]
        public void FacingAShelvedWareOffersToTakeItBack()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem, 0);

            var result = Do(world.Shelf.AccessCell, Facing.Up, ShopActionKind.TakeFromShelf);

            Assert.That(result.Success, Is.True);
            Assert.That(gem.Location, Is.EqualTo(ItemLocation.InPlayerBag()));
        }

        [Test]
        public void AWareAShopperHasClaimedCannotBeSnatchedBack()
        {
            world.StockShelf(ShopTestWorld.Gem, 0);
            world.Simulation.Open(world.Shop);
            world.Admit(world.Collector);
            world.Run(1);

            var prompts = world.PromptsAt(world.Shelf.AccessCell, Facing.Up);

            Assert.That(prompts.Any(a => a.Kind == ShopActionKind.TakeFromShelf), Is.False);
        }

        [Test]
        public void StorageTakesTheHeldWareAndGivesItBack()
        {
            var relic = world.CarryInBag(ShopTestWorld.Relic);

            Assert.That(Do(world.Layout.StorageCell, Facing.Down, ShopActionKind.StoreHeldItem).Success, Is.True);
            Assert.That(relic.Location, Is.EqualTo(ItemLocation.InShopStorage()));

            Assert.That(Do(world.Layout.StorageCell, Facing.Down, ShopActionKind.TakeFromStorage).Success, Is.True);
            Assert.That(relic.Location, Is.EqualTo(ItemLocation.InPlayerBag()));
        }

        [Test]
        public void TheCounterOpensAndThenClosesTheShop()
        {
            Assert.That(Do(world.Layout.ClerkCell, Facing.Down, ShopActionKind.OpenShop).Success, Is.True);
            Assert.That(world.Shop.Phase, Is.EqualTo(ShopPhase.Open));
            Assert.That(world.State.Mode, Is.EqualTo(GameMode.HomeShopOpen));

            Assert.That(Do(world.Layout.ClerkCell, Facing.Down, ShopActionKind.CloseShop).Success, Is.True);
            Assert.That(world.Shop.Phase, Is.EqualTo(ShopPhase.ClosingUp));
        }

        [Test]
        public void TheCheckoutPromptNamesTheShopperAndThePrice()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Collector);
            world.RunUntil(() => visit.Phase == CustomerPhase.AtCounter);

            var prompt = world.PromptsAt(world.Layout.ClerkCell, Facing.Down)
                .First(a => a.Kind == ShopActionKind.ServeCustomer);

            Assert.That(prompt.Label, Does.Contain(world.Collector.Name));
            Assert.That(prompt.Label, Does.Contain(world.Sales.AskingPrice(gem).ToString()));
        }

        [Test]
        public void PaymentIsOnlyOfferedWhileTheMerchantIsAtTheCounter()
        {
            world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Collector);
            world.RunUntil(() => visit.Phase == CustomerPhase.AtCounter);

            var elsewhere = world.PromptsAt(world.Shelf.AccessCell, Facing.Up);

            Assert.That(elsewhere.Any(a => a.Kind == ShopActionKind.ServeCustomer), Is.False,
                "walking away from the counter has to actually cost something");
        }

        [Test]
        public void ADepartedShopperKeepsWaitingWhileTheMerchantIsAway()
        {
            world.StockShelf(ShopTestWorld.Gem);
            world.Simulation.Open(world.Shop);
            var visit = world.Admit(world.Collector);
            world.RunUntil(() => visit.Phase == CustomerPhase.AtCounter);

            var before = visit.WaitTicks;
            world.Run(20);

            Assert.That(visit.WaitTicks, Is.GreaterThan(before));
        }

        [Test]
        public void TheDoorRefusesASecondExpeditionOnTheSameDay()
        {
            Assert.That(world.Flow.TryDepart(), Is.True);
            world.Flow.Return(RunOutcome.Returned);

            var prompt = world.PromptsAt(world.Layout.DungeonExit, Facing.Down)
                .First(a => a.Kind == ShopActionKind.LeaveForDungeon);

            Assert.That(prompt.Label, Does.Contain("今日はもう"));
            Assert.That(world.Actions.Execute(world.Layout, world.Shop, prompt).Success, Is.False);
        }

        [Test]
        public void AFullBagRefusesToTakeAWareOffTheShelf()
        {
            var gem = world.StockShelf(ShopTestWorld.Gem, 0);
            world.Inventory.SlotCapacity = 0;

            var result = Do(world.Shelf.AccessCell, Facing.Up, ShopActionKind.TakeFromShelf);

            Assert.That(result.Success, Is.False);
            Assert.That(gem.Location.Place, Is.EqualTo(ItemPlace.ShelfSlot));
        }
    }
}
