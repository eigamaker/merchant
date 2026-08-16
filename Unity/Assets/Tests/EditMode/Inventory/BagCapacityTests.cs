using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// Slots and bulk are two separate limits, and stacking has to interact with
    /// both correctly: merging into a stack the player already carries costs
    /// neither, which is what lets a full bag still absorb one more herb.
    /// </summary>
    public sealed class BagCapacityTests
    {
        [Test]
        public void BulkIsCountedOncePerStack()
        {
            var world = new InventoryTestWorld();
            var statue = world.SpawnOnGround(InventoryTestWorld.Statue);
            var sword = world.SpawnOnGround(InventoryTestWorld.Sword);

            world.Items.TryPickUp(statue.Uuid);
            world.Items.TryPickUp(sword.Uuid);

            Assert.That(world.Items.UsedBagSlots, Is.EqualTo(2));
            Assert.That(world.Items.UsedBagBulk, Is.EqualTo(5), "statue is bulk 3, sword is bulk 2");
        }

        [Test]
        public void AFullSlotCountRejectsANewStack()
        {
            var world = new InventoryTestWorld(slotCapacity: 2, bulkCapacity: 99);
            world.SpawnInBag(InventoryTestWorld.Sword);
            world.SpawnInBag(InventoryTestWorld.Statue);
            var extra = world.SpawnOnGround(InventoryTestWorld.Herb);

            var result = world.Items.TryPickUp(extra.Uuid);

            Assert.That(result.Rejection, Is.EqualTo(MoveRejection.NoBagSlot));
            Assert.That(extra.Location.Place, Is.EqualTo(ItemPlace.DungeonGround));
        }

        [Test]
        public void ExceedingTotalBulkRejectsThePickup()
        {
            var world = new InventoryTestWorld(slotCapacity: 16, bulkCapacity: 4);
            world.SpawnInBag(InventoryTestWorld.Statue); // bulk 3
            var sword = world.SpawnOnGround(InventoryTestWorld.Sword); // bulk 2

            var result = world.Items.TryPickUp(sword.Uuid);

            Assert.That(result.Rejection, Is.EqualTo(MoveRejection.NoBagBulk));
        }

        [Test]
        public void AFullBagStillAbsorbsIntoAStackItAlreadyCarries()
        {
            var world = new InventoryTestWorld(slotCapacity: 1, bulkCapacity: 1);
            var carried = world.SpawnInBag(InventoryTestWorld.Herb, quantity: 2);
            var found = world.SpawnOnGround(InventoryTestWorld.Herb, quantity: 3);

            var result = world.Items.TryPickUp(found.Uuid);

            Assert.That(result.Success, Is.True);
            Assert.That(result.Merged, Is.True);
            Assert.That(result.ResultUuid, Is.EqualTo(carried.Uuid));
            Assert.That(carried.Quantity, Is.EqualTo(5));
            Assert.That(world.Ledger.Contains(found.Uuid), Is.False, "the absorbed instance stops existing");
            Assert.That(world.Items.UsedBagSlots, Is.EqualTo(1));
        }

        [Test]
        public void AStackNeverGrowsPastItsMaximum()
        {
            var world = new InventoryTestWorld();
            var carried = world.SpawnInBag(InventoryTestWorld.Herb, quantity: 9);
            var found = world.SpawnOnGround(InventoryTestWorld.Herb, quantity: 3);

            var result = world.Items.TryPickUp(found.Uuid);

            Assert.That(result.Success, Is.True);
            Assert.That(result.Merged, Is.False, "9 + 3 exceeds maxStack 10, so it takes its own slot");
            Assert.That(carried.Quantity, Is.EqualTo(9));
            Assert.That(world.Items.UsedBagSlots, Is.EqualTo(2));
        }

        [Test]
        public void WaresAndEquipmentNeverStack()
        {
            var world = new InventoryTestWorld();
            world.SpawnInBag(InventoryTestWorld.Sword);
            var second = world.SpawnOnGround(InventoryTestWorld.Sword);

            var result = world.Items.TryPickUp(second.Uuid);

            Assert.That(result.Merged, Is.False);
            Assert.That(world.Items.UsedBagSlots, Is.EqualTo(2));
        }

        [Test]
        public void DifferentAppraisalStatesDoNotMerge()
        {
            var world = new InventoryTestWorld();
            var known = world.SpawnInBag(InventoryTestWorld.Herb, quantity: 1);
            world.Ledger.SetKnowledge(known, KnowledgeLevel.Identified, 1, "鑑定済み");
            var unknown = world.SpawnOnGround(InventoryTestWorld.Herb, quantity: 1);

            var result = world.Items.TryPickUp(unknown.Uuid);

            Assert.That(result.Merged, Is.False, "provenance is part of the stack key");
            Assert.That(world.Ledger.InBag().Count(), Is.EqualTo(2));
        }

        [Test]
        public void ConsumingTheLastUnitRemovesTheStack()
        {
            var world = new InventoryTestWorld();
            var bombs = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 2);

            Assert.That(world.Items.TryConsume(bombs.Uuid), Is.True);
            Assert.That(bombs.Quantity, Is.EqualTo(1));
            Assert.That(world.Ledger.Contains(bombs.Uuid), Is.True);

            Assert.That(world.Items.TryConsume(bombs.Uuid), Is.True);
            Assert.That(world.Ledger.Contains(bombs.Uuid), Is.False);
        }

        [Test]
        public void ConsumingMoreThanTheStackHoldsFails()
        {
            var world = new InventoryTestWorld();
            var bombs = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 2);

            Assert.That(world.Items.TryConsume(bombs.Uuid, 3), Is.False);
            Assert.That(bombs.Quantity, Is.EqualTo(2));
        }
    }
}
