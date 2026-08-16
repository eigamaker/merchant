using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    public sealed class GridPosTests
    {
        [Test]
        public void UpIncreasesYSoDomainCoordinatesMatchUnityWorldSpace()
        {
            Assert.That(new GridPos(3, 4) + GridPos.Up, Is.EqualTo(new GridPos(3, 5)));
            Assert.That(new GridPos(3, 4) + GridPos.Down, Is.EqualTo(new GridPos(3, 3)));
        }

        [Test]
        public void AdjacentCellsAreExactlyDistanceOne()
        {
            var centre = new GridPos(5, 5);
            foreach (var step in GridPos.Orthogonal)
                Assert.That(GridPos.Distance(centre, centre + step), Is.EqualTo(1));

            Assert.That(GridPos.Distance(centre, new GridPos(6, 6)), Is.EqualTo(2), "diagonals are never adjacent");
        }

        [Test]
        public void EqualPositionsShareAHashCode()
        {
            var set = new System.Collections.Generic.HashSet<GridPos> { new GridPos(2, 7) };
            Assert.That(set.Contains(new GridPos(2, 7)), Is.True);
            Assert.That(set.Contains(new GridPos(7, 2)), Is.False);
        }
    }
}
