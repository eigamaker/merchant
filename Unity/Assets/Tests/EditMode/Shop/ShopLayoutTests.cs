using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// Most ways of misbuilding a shop look fine in the editor and only show up as
    /// customers standing still, so the validator is the thing that has to catch
    /// them.
    /// </summary>
    public sealed class ShopLayoutTests
    {
        [Test]
        public void TheTestShopIsWellFormed()
        {
            var problems = new ShopTestWorld().Layout.Validate();

            Assert.That(problems, Is.Empty, string.Join("; ", problems));
        }

        [Test]
        public void AShelfSlotDrawnOnOpenFloorIsReported()
        {
            var world = new ShopTestWorld();
            var floor = world.Layout.Floor;
            // (5,3) is open floor, not furniture.
            var strayShelf = new ShelfFixture("stray", new GridPos(5, 2), new[] { new GridPos(5, 3) });

            var layout = new ShopLayout(floor, world.Layout.CustomerEntrance, world.Layout.DungeonExit,
                world.Layout.StorageCell, world.Layout.ClerkCell, world.Layout.QueueCells, new[] { strayShelf });

            Assert.That(layout.Validate().Any(p => p.Contains("open floor")), Is.True);
        }

        [Test]
        public void AShelfNobodyCanWalkToIsReported()
        {
            var world = new ShopTestWorld();
            // (1,4) is open but sealed off from the rest of the room.
            var sealedOff = new ShelfFixture("sealed", new GridPos(1, 4), new[] { new GridPos(2, 4) });

            var layout = new ShopLayout(world.Layout.Floor, world.Layout.CustomerEntrance, world.Layout.DungeonExit,
                world.Layout.StorageCell, world.Layout.ClerkCell, world.Layout.QueueCells, new[] { sealedOff });

            Assert.That(layout.Validate().Any(p => p.Contains("walked to") || p.Contains("stood at")), Is.True);
        }

        [Test]
        public void AQueueThatDoesNotEndAtTheCounterIsReported()
        {
            var world = new ShopTestWorld();
            var strandedQueue = new[] { new GridPos(2, 2), new GridPos(3, 2) };
            // The merchant stands at (8,2); a queue starting at (2,2) is across the room.

            var layout = new ShopLayout(world.Layout.Floor, world.Layout.CustomerEntrance, world.Layout.DungeonExit,
                world.Layout.StorageCell, world.Layout.ClerkCell, strandedQueue, world.Layout.Shelves);

            Assert.That(layout.Validate().Any(p => p.Contains("front of the queue")), Is.True);
        }

        [Test]
        public void AShelfWithNoSlotsIsReported()
        {
            var world = new ShopTestWorld();
            var empty = new ShelfFixture("empty", new GridPos(3, 3), new GridPos[0]);

            var layout = new ShopLayout(world.Layout.Floor, world.Layout.CustomerEntrance, world.Layout.DungeonExit,
                world.Layout.StorageCell, world.Layout.ClerkCell, world.Layout.QueueCells, new[] { empty });

            Assert.That(layout.Validate().Any(p => p.Contains("no slots")), Is.True);
        }

        [Test]
        public void ACellIsTracedBackToItsShelfFromEitherSide()
        {
            var world = new ShopTestWorld();

            Assert.That(world.Layout.ShelfAt(new GridPos(3, 4))?.Id, Is.EqualTo("shelf-a"), "a slot cell");
            Assert.That(world.Layout.ShelfAt(world.Shelf.AccessCell)?.Id, Is.EqualTo("shelf-a"), "the cell you stand in");
            Assert.That(world.Layout.ShelfAt(new GridPos(7, 2)), Is.Null);
        }
    }
}
