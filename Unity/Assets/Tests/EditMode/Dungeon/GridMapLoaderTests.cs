using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The authoring pipeline: a map drawn in the browser editor has to arrive in
    /// the game the right way up, with its walls in the same places.
    /// </summary>
    public sealed class GridMapLoaderTests
    {
        /// <summary>
        /// 4 wide, 3 tall, top-down. The top row is open, the bottom-left corner
        /// is solid — an asymmetric shape, so a vertical flip cannot pass by luck.
        /// </summary>
        private static ManualMapDto Sample()
        {
            return new ManualMapDto
            {
                Version = ManualMapDto.SupportedVersion,
                Id = "test-floor",
                Kind = "dungeon",
                Width = 4,
                Height = 3,
                Collision = new[]
                {
                    0, 0, 0, 0,
                    0, 1, 0, 0,
                    1, 1, 0, 0
                },
                HardEdges = new string[0],
                Entrance = new ManualPointDto { X = 0, Y = 0 },
                Stairs = new ManualPointDto { X = 3, Y = 2 }
            };
        }

        [Test]
        public void TheMapArrivesTheRightWayUp()
        {
            var map = GridMapLoader.FromManualMap(Sample());

            Assert.That(map.Entrance, Is.EqualTo(new GridPos(0, 2)), "editor row 0 is the top, which is the highest y");
            Assert.That(map.Stairs, Is.EqualTo(new GridPos(3, 0)));
            Assert.That(map.IsWalkable(new GridPos(0, 2)), Is.True);
            Assert.That(map.IsWalkable(new GridPos(0, 0)), Is.False, "the solid bottom-left corner stays at the bottom");
            Assert.That(map.IsWalkable(new GridPos(1, 1)), Is.False, "the middle block keeps its place");
        }

        [Test]
        public void AnEastEdgeSurvivesTheFlip()
        {
            var dto = Sample();
            dto.HardEdges = new[] { "2,0,east" };

            var map = GridMapLoader.FromManualMap(dto);

            Assert.That(map.CanTraverse(new GridPos(2, 2), new GridPos(3, 2)), Is.False);
            Assert.That(map.CanTraverse(new GridPos(2, 1), new GridPos(3, 1)), Is.True, "only the marked row is walled");
        }

        [Test]
        public void ASouthEdgeBecomesTheBorderBelowTheSameVisualCell()
        {
            var dto = Sample();
            dto.HardEdges = new[] { "3,0,south" };

            var map = GridMapLoader.FromManualMap(dto);

            // Editor (3,0) is the top-right cell, y=2 here. Its "south" neighbour is
            // the cell visually beneath it, which is y=1.
            Assert.That(map.CanTraverse(new GridPos(3, 2), new GridPos(3, 1)), Is.False);
            Assert.That(map.CanTraverse(new GridPos(3, 1), new GridPos(3, 0)), Is.True);
        }

        [Test]
        public void AMapWhoseStairsCannotBeReachedIsRejected()
        {
            var dto = Sample();
            dto.Collision = new[]
            {
                0, 0, 1, 0,
                0, 0, 1, 0,
                0, 0, 1, 0
            };

            var problems = GridMapLoader.Validate(dto);

            Assert.That(problems.Any(p => p.Contains("walked to")), Is.True);
            Assert.That(() => GridMapLoader.FromManualMap(dto), Throws.ArgumentException);
        }

        [Test]
        public void AHardEdgeCanStrandTheStairsEvenWithNoWallDrawn()
        {
            var dto = Sample();
            dto.Collision = Enumerable.Repeat(0, 12).ToArray();
            dto.HardEdges = new[] { "2,0,east", "2,1,east", "2,2,east" };

            var problems = GridMapLoader.Validate(dto);

            Assert.That(problems.Any(p => p.Contains("walked to")), Is.True, "edges are as solid as painted walls");
        }

        [Test]
        public void MarkersStandingInWallsAreReported()
        {
            var dto = Sample();
            dto.Entrance = new ManualPointDto { X = 1, Y = 1 };

            var problems = GridMapLoader.Validate(dto);

            Assert.That(problems.Any(p => p.Contains("entrance")), Is.True);
        }

        [Test]
        public void AMalformedMapIsReportedRatherThanLoadedHalfway()
        {
            var problems = GridMapLoader.Validate(new ManualMapDto
            {
                Version = ManualMapDto.SupportedVersion,
                Width = 4,
                Height = 3,
                Collision = new[] { 0, 0 }
            });

            Assert.That(problems.Any(p => p.Contains("collision grid")), Is.True);
            Assert.That(problems.Any(p => p.Contains("entrance")), Is.True);
        }

        [Test]
        public void AFutureMapVersionIsRefused()
        {
            var dto = Sample();
            dto.Version = 99;

            Assert.That(GridMapLoader.Validate(dto).Any(p => p.Contains("version")), Is.True);
        }

        [Test]
        public void ALoadedMapIsImmediatelyPlayable()
        {
            var dto = Sample();
            var map = GridMapLoader.FromManualMap(dto);
            var run = new DungeonRunState(map, 1, 1, new PlayerActor(map.Entrance));

            Assert.That(run.CanStep(map.Entrance, map.Entrance + GridPos.Right), Is.True);
            Assert.That(map.ReachableFrom(map.Entrance), Contains.Item(map.Stairs));
        }
    }
}
