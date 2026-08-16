using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The escort is the party's fighting strength and the enemies are the reason
    /// to avoid a fight. These tests pin the priorities that make that read.
    /// </summary>
    public sealed class EscortAndEnemyTests
    {
        private DungeonTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new DungeonTestWorld();
        }

        [Test]
        public void NoTwoActorsEverShareACell()
        {
            world.AddGuard(new GridPos(2, 2));
            world.AddEnemy(world.Orc, new GridPos(5, 2));
            world.AddEnemy(world.Orc, new GridPos(5, 3), "orc-2");

            for (var i = 0; i < 12; i++)
            {
                world.Do(DungeonCommand.Wait());

                var occupied = world.Run.Enemies.Select(enemy => enemy.Position).ToList();
                occupied.Add(world.Player.Position);
                if (world.Run.Guard != null) occupied.Add(world.Run.Guard.Position);

                Assert.That(occupied.Distinct().Count(), Is.EqualTo(occupied.Count), $"actors overlapped on turn {world.Run.Turn}");
            }
        }

        [Test]
        public void TheEscortCutsDownAnAdjacentEnemy()
        {
            world.AddGuard(new GridPos(1, 2));
            var slime = world.AddEnemy(world.Slime, new GridPos(1, 3));

            world.Do(DungeonCommand.Wait());

            Assert.That(world.Run.Enemies, Has.No.Member(slime),"guard damage 3 against 2 hit points");
        }

        [Test]
        public void TheEscortShovesRatherThanTradesWhenTheMerchantIsCornered()
        {
            world.AddGuard(new GridPos(4, 3));
            var orc = world.AddEnemy(world.Orc, new GridPos(4, 2));

            var result = world.Do(DungeonCommand.Wait());

            Assert.That(orc.Position, Is.EqualTo(new GridPos(4, 1)), "pushed off the merchant");
            Assert.That(orc.Hp, Is.EqualTo(world.Orc.MaxHp), "shoving deals no damage");
            // The escort acts before the enemies, so being shoved costs the orc the
            // rest of this turn rather than only slowing it down next turn.
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.Staggered && e.ActorId == orc.Id), Is.True);
            Assert.That(world.State.Hp, Is.EqualTo(world.State.MaxHp), "and so it never lands its blow");
        }

        [Test]
        public void TheEscortStillKillsWhenTheBlowWouldFinishTheEnemy()
        {
            world.AddGuard(new GridPos(4, 3));
            var slime = world.AddEnemy(world.Slime, new GridPos(4, 2));

            world.Do(DungeonCommand.Wait());

            Assert.That(world.Run.Enemies, Has.No.Member(slime),"killing beats pushing when it is available");
        }

        [Test]
        public void TheEscortClosesUpOnTheMerchantWhenNothingThreatens()
        {
            var guard = world.AddGuard(new GridPos(5, 3));

            world.Do(DungeonCommand.Wait());

            Assert.That(GridPos.Distance(guard.Position, world.Player.Position), Is.LessThan(GridPos.Distance(new GridPos(5, 3), world.Player.Position)));
        }

        [Test]
        public void TheEscortTakesABlowMeantForTheMerchant()
        {
            var guard = world.AddGuard(new GridPos(3, 3));
            world.AddEnemy(world.Orc, new GridPos(4, 2));
            var hpBefore = world.State.Hp;

            var result = world.Do(DungeonCommand.Wait());

            Assert.That(world.State.Hp, Is.EqualTo(hpBefore), "the merchant should be untouched");
            Assert.That(guard.Hp, Is.LessThan(guard.MaxHp));
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.Intercepted), Is.True);
        }

        [Test]
        public void TheEscortInterceptsOnlyOncePerTurn()
        {
            world.AddGuard(new GridPos(3, 3));
            world.AddEnemy(world.Slime, new GridPos(4, 2));
            world.AddEnemy(world.Slime, new GridPos(2, 2), "slime-2");
            var hpBefore = world.State.Hp;

            var result = world.Do(DungeonCommand.Wait());

            Assert.That(result.Events.Count(e => e.Kind == DungeonEventKind.Intercepted), Is.EqualTo(1));
            Assert.That(world.State.Hp, Is.LessThan(hpBefore), "the second attacker gets through");
        }

        [Test]
        public void AnUnescortedMerchantIsHitDirectly()
        {
            world.AddEnemy(world.Slime, new GridPos(4, 2));
            var hpBefore = world.State.Hp;

            world.Do(DungeonCommand.Wait());

            Assert.That(world.State.Hp, Is.EqualTo(hpBefore - world.Slime.Damage));
        }

        [Test]
        public void AFallenEscortWithdrawsInsteadOfDying()
        {
            var guard = world.AddGuard(new GridPos(1, 1));
            guard.Hp = 1;
            world.AddEnemy(world.Orc, new GridPos(1, 2));

            var result = world.Do(DungeonCommand.Wait());

            Assert.That(world.Run.Guard, Is.Null, "the merchant is now alone");
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.Defeated && e.ActorId == guard.Id), Is.True);
        }

        [Test]
        public void ReachingZeroExposureRescuesRatherThanKills()
        {
            world.State.Hp = 1;
            world.AddEnemy(world.Orc, new GridPos(4, 2));

            var result = world.Do(DungeonCommand.Wait());

            Assert.That(world.Run.Outcome, Is.EqualTo(RunOutcome.Rescued));
            Assert.That(world.State.Hp, Is.EqualTo(0), "exposure never goes negative");
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.Rescued), Is.True);
        }

        [Test]
        public void AStaggeredEnemyLosesItsTurn()
        {
            var orc = world.AddEnemy(world.Orc, new GridPos(5, 2));
            orc.StaggerTurns = 1;
            var before = orc.Position;

            var result = world.Do(DungeonCommand.Wait());

            Assert.That(orc.Position, Is.EqualTo(before));
            Assert.That(orc.StaggerTurns, Is.EqualTo(0));
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.Staggered), Is.True);
        }

        [Test]
        public void AnEnemyOutOfRangeDropsFromChasingToSearching()
        {
            var narrow = new EnemyDefinition("watcher", "見張り", 5, 1, chaseRange: 1, pushResistance: 1, lootTableId: "always-nothing");
            var enemy = world.AddEnemy(narrow, new GridPos(5, 3));
            enemy.State = EnemyState.Chase;

            world.Do(DungeonCommand.Wait());

            Assert.That(enemy.State, Is.EqualTo(EnemyState.Search));
        }

        [Test]
        public void TheSameSeedReplaysTheSameEnemyMovement()
        {
            var first = Replay(new DungeonTestWorld(seed: 7));
            var second = Replay(new DungeonTestWorld(seed: 7));
            var different = Replay(new DungeonTestWorld(seed: 8));

            Assert.That(second, Is.EqualTo(first));
            Assert.That(different, Is.Not.EqualTo(first), "a different seed should not walk the same path");
        }

        private static string Replay(DungeonTestWorld run)
        {
            var wanderer = new EnemyDefinition("wanderer", "徘徊者", 9, 1, chaseRange: 0, pushResistance: 9, lootTableId: "always-nothing");
            run.AddEnemy(wanderer, new GridPos(5, 3));

            var trail = new System.Text.StringBuilder();
            for (var i = 0; i < 10; i++)
            {
                run.Do(DungeonCommand.Wait());
                trail.Append(run.Run.Enemies[0].Position).Append(';');
            }
            return trail.ToString();
        }
    }
}
