using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    public sealed class GridMapTests
    {
        private static readonly string[] Room =
        {
            "#####",
            "#...#",
            "#.#.#",
            "#...#",
            "#####"
        };

        private static GridMap Build() => GridMap.FromRows(Room, new GridPos(1, 1), new GridPos(3, 3));

        [Test]
        public void RowsAreFlippedSoTheFirstRowIsTheTopOfTheMap()
        {
            var map = GridMap.FromRows(new[] { "...", "###" }, new GridPos(0, 1), new GridPos(2, 1));

            Assert.That(map.IsWalkable(new GridPos(1, 1)), Is.True, "the first row is the highest y");
            Assert.That(map.IsWalkable(new GridPos(1, 0)), Is.False);
        }

        [Test]
        public void TheCollisionGridUsesZeroForWalkable()
        {
            var map = GridMap.FromCollisionGrid(new[] { 0, 0, 0, 1, 1, 1 }, 3, 2, new GridPos(0, 1), new GridPos(2, 1));

            Assert.That(map.IsWalkable(new GridPos(1, 1)), Is.True);
            Assert.That(map.IsWalkable(new GridPos(1, 0)), Is.False);
        }

        [Test]
        public void OutOfBoundsCellsAreNeverWalkable()
        {
            var map = Build();

            Assert.That(map.IsWalkable(new GridPos(-1, 1)), Is.False);
            Assert.That(map.IsWalkable(new GridPos(1, 99)), Is.False);
        }

        [Test]
        public void DiagonalStepsAreNeverTraversable()
        {
            var map = Build();

            Assert.That(map.CanTraverse(new GridPos(1, 1), new GridPos(2, 2)), Is.False);
        }

        [Test]
        public void AStepIntoAWallIsRefused()
        {
            var map = Build();

            Assert.That(map.CanTraverse(new GridPos(1, 2), new GridPos(2, 2)), Is.False, "(2,2) is the pillar");
            Assert.That(map.CanTraverse(new GridPos(1, 2), new GridPos(1, 1)), Is.True);
        }

        [Test]
        public void AHardEdgeBlocksAStepBetweenTwoOpenCells()
        {
            var wall = MapEdge.Between(new GridPos(1, 1), new GridPos(2, 1));
            var map = GridMap.FromRows(Room, new GridPos(1, 1), new GridPos(3, 3), new[] { wall.Value });

            Assert.That(map.IsWalkable(new GridPos(2, 1)), Is.True);
            Assert.That(map.CanTraverse(new GridPos(1, 1), new GridPos(2, 1)), Is.False);
            Assert.That(map.CanTraverse(new GridPos(2, 1), new GridPos(1, 1)), Is.False, "an edge blocks both directions");
        }

        [Test]
        public void EdgesBetweenTheSameTwoCellsAreOneEdgeWhicheverWayYouCrossThem()
        {
            var forward = MapEdge.Between(new GridPos(4, 6), new GridPos(4, 7));
            var backward = MapEdge.Between(new GridPos(4, 7), new GridPos(4, 6));

            Assert.That(forward, Is.EqualTo(backward));
        }

        [Test]
        public void ReachabilityWalksAroundThePillarAndStopsAtTheWalls()
        {
            var map = Build();

            var reached = map.ReachableFrom(new GridPos(1, 1));

            Assert.That(reached.Count, Is.EqualTo(8), "the 3x3 interior minus the pillar");
            Assert.That(reached.Contains(new GridPos(3, 3)), Is.True);
            Assert.That(reached.Contains(new GridPos(2, 2)), Is.False);
        }

        [Test]
        public void AHardEdgeCanStrandPartOfAnAuthoredMap()
        {
            var corridor = new[] { "#####", "#...#", "#####" };
            var wall = MapEdge.Between(new GridPos(2, 1), new GridPos(3, 1)).Value;
            var map = GridMap.FromRows(corridor, new GridPos(1, 1), new GridPos(3, 1), new[] { wall });

            var reached = map.ReachableFrom(map.Entrance);

            Assert.That(reached.Contains(map.Stairs), Is.False, "this is the check an authored map must pass");
        }
    }
}
