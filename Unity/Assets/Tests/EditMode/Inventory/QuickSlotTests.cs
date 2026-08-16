using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// Quick slots reference bag items, they do not copy them. Every way an item
    /// can stop being carried — shelved, sold, dropped, drunk, merged away — has
    /// to leave the slots pointing at nothing stale.
    /// </summary>
    public sealed class QuickSlotTests
    {
        private InventoryTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new InventoryTestWorld();
        }

        [Test]
        public void ASlotReferencesTheSameInstanceTheBagHolds()
        {
            var sword = world.SpawnInBag(InventoryTestWorld.Sword);

            Assert.That(world.QuickSlots.TryAssign(0, sword.Uuid), Is.True);
            world.QuickSlots.Select(0);

            Assert.That(world.QuickSlots.Held(), Is.SameAs(sword));
            Assert.That(world.Items.UsedBagSlots, Is.EqualTo(1), "binding a shortcut does not duplicate the item");
        }

        [Test]
        public void AnItemOutsideTheBagCannotBeBound()
        {
            var shelved = world.Spawn(InventoryTestWorld.Sword, ItemLocation.OnShelf("shelf-a", 0));

            Assert.That(world.QuickSlots.TryAssign(0, shelved.Uuid), Is.False);
        }

        [Test]
        public void BindingAnAlreadyBoundItemMovesItInsteadOfDuplicating()
        {
            var sword = world.SpawnInBag(InventoryTestWorld.Sword);
            world.QuickSlots.TryAssign(0, sword.Uuid);

            world.QuickSlots.TryAssign(3, sword.Uuid);

            Assert.That(world.QuickSlots.AtSlot(0), Is.Null);
            Assert.That(world.QuickSlots.AtSlot(3), Is.SameAs(sword));
        }

        [Test]
        public void ShelvingAnItemEmptiesItsQuickSlot()
        {
            var sword = world.SpawnInBag(InventoryTestWorld.Sword);
            world.QuickSlots.TryAssign(1, sword.Uuid);

            world.Items.TryMove(sword.Uuid, ItemLocation.OnShelf("shelf-a", 0));

            Assert.That(world.QuickSlots.AtSlot(1), Is.Null);
        }

        [Test]
        public void StoringSellingAndDroppingAllEmptyTheQuickSlot()
        {
            foreach (var destination in new[] { ItemLocation.InShopStorage(), ItemLocation.Sold(), ItemLocation.OnDungeonGround(new GridPos(2, 2)) })
            {
                var fresh = new InventoryTestWorld();
                var item = fresh.SpawnInBag(InventoryTestWorld.Sword);
                fresh.QuickSlots.TryAssign(2, item.Uuid);

                fresh.Items.TryMove(item.Uuid, destination);

                Assert.That(fresh.QuickSlots.AtSlot(2), Is.Null, $"moving to {destination} left a stale reference");
            }
        }

        [Test]
        public void DrinkingTheLastConsumableEmptiesItsQuickSlot()
        {
            var bombs = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 1);
            world.QuickSlots.TryAssign(4, bombs.Uuid);

            world.Items.TryConsume(bombs.Uuid);

            Assert.That(world.QuickSlots.AtSlot(4), Is.Null);
        }

        [Test]
        public void MergingIntoACarriedStackKeepsTheExistingBinding()
        {
            var carried = world.SpawnInBag(InventoryTestWorld.Herb, quantity: 1);
            world.QuickSlots.TryAssign(0, carried.Uuid);
            var found = world.SpawnOnGround(InventoryTestWorld.Herb, quantity: 2);

            world.Items.TryPickUp(found.Uuid);

            Assert.That(world.QuickSlots.AtSlot(0), Is.SameAs(carried), "the surviving stack keeps the shortcut");
            Assert.That(carried.Quantity, Is.EqualTo(3));
        }

        [Test]
        public void OnlyConsumablesCanTakeTheQuickConsumableSlot()
        {
            var sword = world.SpawnInBag(InventoryTestWorld.Sword);
            var bombs = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 2);

            Assert.That(world.QuickSlots.TrySetQuickConsumable(sword.Uuid), Is.False);
            Assert.That(world.QuickSlots.TrySetQuickConsumable(bombs.Uuid), Is.True);
            Assert.That(world.QuickSlots.QuickConsumable(), Is.SameAs(bombs));
        }

        [Test]
        public void SpendingTheQuickConsumableRelinksToAnotherStackOfTheSameKind()
        {
            var first = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 1);
            var spare = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 4);
            world.QuickSlots.TrySetQuickConsumable(first.Uuid);

            world.Items.TryConsume(first.Uuid);

            Assert.That(world.QuickSlots.QuickConsumable(), Is.SameAs(spare), "C should not silently unbind while stock remains");
        }

        [Test]
        public void SpendingTheLastConsumableLeavesTheQuickSlotEmpty()
        {
            var only = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 1);
            world.QuickSlots.TrySetQuickConsumable(only.Uuid);

            world.Items.TryConsume(only.Uuid);

            Assert.That(world.QuickSlots.QuickConsumable(), Is.Null);
        }

        [Test]
        public void SelectionWrapsInBothDirections()
        {
            world.QuickSlots.Select(0);

            world.QuickSlots.SelectRelative(-1);
            Assert.That(world.Inventory.SelectedQuickSlot, Is.EqualTo(InventoryState.QuickSlotCount - 1));

            world.QuickSlots.SelectRelative(1);
            Assert.That(world.Inventory.SelectedQuickSlot, Is.EqualTo(0));
        }

        [Test]
        public void SelectingAnEmptySlotLeavesNothingHeld()
        {
            var sword = world.SpawnInBag(InventoryTestWorld.Sword);
            world.QuickSlots.TryAssign(0, sword.Uuid);
            world.QuickSlots.Select(1);

            Assert.That(world.QuickSlots.Held(), Is.Null);
        }
    }
}
