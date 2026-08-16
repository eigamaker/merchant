using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// Expected values were produced by running src/game/rng.ts under node, so a
    /// regression here means the C# port drifted from the reference generator
    /// and previously recorded dungeon seeds would replay differently.
    /// </summary>
    public sealed class RngTests
    {
        private const double Tolerance = 1e-12;

        [Test]
        public void MatchesBrowserSequenceForSeedOne()
        {
            var rng = new Rng(1);
            Assert.That(rng.Next(), Is.EqualTo(0.62707394058816135).Within(Tolerance));
            Assert.That(rng.Next(), Is.EqualTo(0.00273572118021548).Within(Tolerance));
            Assert.That(rng.Next(), Is.EqualTo(0.52744703995995224).Within(Tolerance));
            Assert.That(rng.Next(), Is.EqualTo(0.98105096747167408).Within(Tolerance));
            Assert.That(rng.Next(), Is.EqualTo(0.96837789821438491).Within(Tolerance));
        }

        [Test]
        public void MatchesBrowserSequenceForLargeSeed()
        {
            var rng = new Rng(12345);
            Assert.That(rng.Next(), Is.EqualTo(0.97972826776094735).Within(Tolerance));
            Assert.That(rng.Next(), Is.EqualTo(0.30675226449966431).Within(Tolerance));
            Assert.That(rng.Next(), Is.EqualTo(0.48420542152598500).Within(Tolerance));
        }

        [Test]
        public void SeedZeroFallsBackToTheBrowsersConstant()
        {
            var rng = new Rng(0);
            Assert.That(rng.Next(), Is.EqualTo(0.00032974570058286).Within(Tolerance));
            Assert.That(rng.Next(), Is.EqualTo(0.22327202744781971).Within(Tolerance));
        }

        [Test]
        public void IntIsInclusiveAndMatchesTheBrowser()
        {
            var rng = new Rng(4242);
            var rolled = new int[10];
            for (var i = 0; i < rolled.Length; i++)
                rolled[i] = rng.Int(0, 9);

            Assert.That(rolled, Is.EqualTo(new[] { 5, 2, 9, 5, 6, 2, 2, 4, 3, 5 }));
        }

        [Test]
        public void SameSeedReplaysTheSameSequence()
        {
            var first = new Rng(99);
            var second = new Rng(99);
            for (var i = 0; i < 32; i++)
                Assert.That(second.Next(), Is.EqualTo(first.Next()));
        }
    }
}
