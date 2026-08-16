using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The single-location invariant from the design doc: an ItemInstance is in
    /// exactly one place, and moving it leaves nothing behind at the old one.
    /// </summary>
    public sealed class ItemOwnershipTests
    {
        private InventoryTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new InventoryTestWorld();
        }

        [Test]
        public void PickingUpRemovesTheItemFromTheDungeonFloor()
        {
            var cell = new GridPos(4, 7);
            var item = world.SpawnOnGround(InventoryTestWorld.Sword, cell.X, cell.Y);

            Assert.That(world.Items.TryPickUp(item.Uuid).Success, Is.True);

            Assert.That(world.Ledger.OnGroundAt(cell), Is.Empty);
            Assert.That(world.Ledger.InBag().Select(i => i.Uuid), Is.EqualTo(new[] { item.Uuid }));
        }

        [Test]
        public void ShelvingRemovesTheItemFromTheBag()
        {
            var item = world.SpawnInBag(InventoryTestWorld.Sword);

            Assert.That(world.Items.TryMove(item.Uuid, ItemLocation.OnShelf("shelf-a", 0)).Success, Is.True);

            Assert.That(world.Ledger.InBag(), Is.Empty);
            Assert.That(world.Ledger.OnShelfSlot("shelf-a", 0), Is.SameAs(item));
        }

        [Test]
        public void EveryItemAppearsInExactlyOnePlaceAfterAFullRoundTrip()
        {
            var sword = world.SpawnOnGround(InventoryTestWorld.Sword, 1, 1);
            var statue = world.SpawnOnGround(InventoryTestWorld.Statue, 2, 2);

            world.Items.TryPickUp(sword.Uuid);
            world.Items.TryPickUp(statue.Uuid);
            world.Items.TryMove(sword.Uuid, ItemLocation.InShopStorage());
            world.Items.TryMove(statue.Uuid, ItemLocation.OnShelf("shelf-a", 1));
            world.Items.TryReserve(statue.Uuid, "customer-1");
            world.Items.TryMove(statue.Uuid, ItemLocation.HeldByCustomer("customer-1"));
            world.Items.TryMove(statue.Uuid, ItemLocation.Sold());

            var snapshot = world.Items.Snapshot();
            Assert.That(snapshot.Values.Sum(bucket => bucket.Count), Is.EqualTo(world.Ledger.All.Count));
            Assert.That(snapshot[ItemLocation.InShopStorage()].Single(), Is.SameAs(sword));
            Assert.That(snapshot[ItemLocation.Sold()].Single(), Is.SameAs(statue));
            Assert.That(world.Ledger.OnShelf("shelf-a"), Is.Empty);
        }

        [Test]
        public void AShelfSlotHoldsAtMostOneItem()
        {
            var first = world.SpawnInBag(InventoryTestWorld.Sword);
            var second = world.SpawnInBag(InventoryTestWorld.Statue);
            var slot = ItemLocation.OnShelf("shelf-a", 2);

            Assert.That(world.Items.TryMove(first.Uuid, slot).Success, Is.True);

            var blocked = world.Items.TryMove(second.Uuid, slot);
            Assert.That(blocked.Success, Is.False);
            Assert.That(blocked.Rejection, Is.EqualTo(MoveRejection.ShelfSlotOccupied));
            Assert.That(second.Location, Is.EqualTo(ItemLocation.InPlayerBag()), "a rejected move must not displace the item");
        }

        [Test]
        public void ASoldItemCanNeverMoveAgain()
        {
            var item = world.SpawnInBag(InventoryTestWorld.Sword);
            world.Items.TryMove(item.Uuid, ItemLocation.Sold());

            var result = world.Items.TryMove(item.Uuid, ItemLocation.InPlayerBag());

            Assert.That(result.Success, Is.False);
            Assert.That(result.Rejection, Is.EqualTo(MoveRejection.Archived));
        }

        [Test]
        public void OnlyTheReservingCustomerMayTakeAWare()
        {
            var item = world.SpawnInBag(InventoryTestWorld.Sword);
            world.Items.TryMove(item.Uuid, ItemLocation.OnShelf("shelf-a", 0));

            Assert.That(world.Items.TryReserve(item.Uuid, "customer-1"), Is.True);
            Assert.That(world.Items.TryReserve(item.Uuid, "customer-2"), Is.False, "a second shopper cannot claim a reserved ware");

            var stolen = world.Items.TryMove(item.Uuid, ItemLocation.HeldByCustomer("customer-2"));
            Assert.That(stolen.Rejection, Is.EqualTo(MoveRejection.Reserved));

            var taken = world.Items.TryMove(item.Uuid, ItemLocation.HeldByCustomer("customer-1"));
            Assert.That(taken.Success, Is.True);
            Assert.That(item.IsReserved, Is.False, "the claim is spent once the ware is in hand");
        }

        [Test]
        public void ReturningAWareToTheShelfClearsTheWayForAnotherShopper()
        {
            var item = world.SpawnInBag(InventoryTestWorld.Sword);
            world.Items.TryMove(item.Uuid, ItemLocation.OnShelf("shelf-a", 0));
            world.Items.TryReserve(item.Uuid, "customer-1");
            world.Items.TryMove(item.Uuid, ItemLocation.HeldByCustomer("customer-1"));

            Assert.That(world.Items.TryMove(item.Uuid, ItemLocation.OnShelf("shelf-a", 0)).Success, Is.True);
            Assert.That(world.Items.TryReserve(item.Uuid, "customer-2"), Is.True);
        }

        [Test]
        public void MovingAnItemToWhereItAlreadyIsChangesNothing()
        {
            var item = world.SpawnInBag(InventoryTestWorld.Sword);

            var result = world.Items.TryMove(item.Uuid, ItemLocation.InPlayerBag());

            Assert.That(result.Success, Is.False);
            Assert.That(result.Rejection, Is.EqualTo(MoveRejection.AlreadyThere));
            Assert.That(world.Ledger.InBag().Count(), Is.EqualTo(1));
        }
    }
}
