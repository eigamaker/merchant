using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// What the merchant can do instead of fighting. Shoving is deterministic on
    /// purpose: the player has to be able to tell in advance whether the thing in
    /// front of them will budge.
    /// </summary>
    public sealed class ShoveAndConsumableTests
    {
        private DungeonTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new DungeonTestWorld();
        }

        [Test]
        public void TheMerchantCanShoveSomethingLightAside()
        {
            var slime = world.AddEnemy(world.Slime, new GridPos(4, 2));
            world.Face(Facing.Right);

            var result = world.Do(DungeonCommand.Shove());

            Assert.That(result.ConsumedTurn, Is.True);
            Assert.That(slime.Position, Is.EqualTo(new GridPos(5, 2)));
            Assert.That(slime.Hp, Is.EqualTo(world.Slime.MaxHp), "a shove is never an attack");
        }

        [Test]
        public void SomethingHeavyDoesNotBudgeForTheMerchant()
        {
            var orc = world.AddEnemy(world.Orc, new GridPos(4, 2));
            world.Face(Facing.Right);

            var result = world.Do(DungeonCommand.Shove());

            Assert.That(orc.Position, Is.EqualTo(new GridPos(4, 2)));
            Assert.That(result.ConsumedTurn, Is.True, "trying and failing still costs the turn");
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.ShoveFailed), Is.True);
        }

        [Test]
        public void AShoveIntoAWallFails()
        {
            var slime = world.AddEnemy(world.Slime, new GridPos(5, 2));
            world.Run.PlacePlayer(new GridPos(4, 2));
            world.Face(Facing.Right);

            var result = world.Do(DungeonCommand.Shove());

            Assert.That(slime.Position, Is.EqualTo(new GridPos(5, 2)));
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.ShoveFailed), Is.True);
        }

        [Test]
        public void ShovingHasACooldownSoItIsNotAFreeAnswerEveryTurn()
        {
            world.AddEnemy(world.Slime, new GridPos(4, 2));
            world.Face(Facing.Right);
            world.Do(DungeonCommand.Shove());

            Assert.That(world.Run.CanShove, Is.False);
            world.Do(DungeonCommand.Wait());
            Assert.That(world.Run.CanShove, Is.False);
            world.Do(DungeonCommand.Wait());
            Assert.That(world.Run.CanShove, Is.True, "ready again after two turns");
        }

        [Test]
        public void SmokeBreaksPursuitForSeveralTurns()
        {
            world.Run.PlacePlayer(new GridPos(1, 1));
            var orc = world.AddEnemy(world.Orc, new GridPos(5, 3));
            orc.State = EnemyState.Chase;
            world.CarryConsumable(DungeonTestWorld.SmokeBomb, 2);

            var result = world.Do(DungeonCommand.UseQuickConsumable());

            Assert.That(result.ConsumedTurn, Is.True);
            Assert.That(orc.State, Is.EqualTo(EnemyState.Search));

            world.Do(DungeonCommand.Wait());
            Assert.That(orc.State, Is.EqualTo(EnemyState.Search), "it should not simply notice again next turn");
        }

        [Test]
        public void PursuitResumesOnceTheSmokeClears()
        {
            world.Run.PlacePlayer(new GridPos(1, 1));
            var orc = world.AddEnemy(world.Orc, new GridPos(5, 3));
            world.CarryConsumable(DungeonTestWorld.SmokeBomb);

            world.Do(DungeonCommand.UseQuickConsumable());
            for (var i = 0; i < 4; i++) world.Do(DungeonCommand.Wait());

            Assert.That(orc.State, Is.EqualTo(EnemyState.Chase));
        }

        [Test]
        public void UsingAConsumableSpendsIt()
        {
            world.Run.PlacePlayer(new GridPos(1, 1));
            world.AddEnemy(world.Orc, new GridPos(5, 3));
            var bombs = world.CarryConsumable(DungeonTestWorld.SmokeBomb, 2);

            world.Do(DungeonCommand.UseQuickConsumable());

            Assert.That(bombs.Quantity, Is.EqualTo(1));
        }

        [Test]
        public void ASalveRestoresExposureAndIsRefusedWhenUnhurt()
        {
            world.CarryConsumable(DungeonTestWorld.Salve);

            var refused = world.Do(DungeonCommand.UseQuickConsumable());
            Assert.That(refused.ConsumedTurn, Is.False, "wasting a salve at full health should not cost a turn");

            world.State.Hp = 4;
            var used = world.Do(DungeonCommand.UseQuickConsumable());

            Assert.That(used.ConsumedTurn, Is.True);
            Assert.That(world.State.Hp, Is.EqualTo(8));
        }

        [Test]
        public void HealingNeverOvershootsTheMaximum()
        {
            world.CarryConsumable(DungeonTestWorld.Salve);
            world.State.Hp = world.State.MaxHp - 1;

            world.Do(DungeonCommand.UseQuickConsumable());

            Assert.That(world.State.Hp, Is.EqualTo(world.State.MaxHp));
        }

        [Test]
        public void AReturnStoneEndsTheExpeditionOnTheSpot()
        {
            world.AddEnemy(world.Orc, new GridPos(4, 2));
            world.CarryConsumable(DungeonTestWorld.ReturnStone);
            var hpBefore = world.State.Hp;

            var result = world.Do(DungeonCommand.UseQuickConsumable());

            Assert.That(world.Run.Outcome, Is.EqualTo(RunOutcome.Returned));
            Assert.That(world.State.Hp, Is.EqualTo(hpBefore), "the adjacent orc never gets its parting blow");
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.LeftDungeon), Is.True);
        }

        [Test]
        public void NothingHappensAfterTheExpeditionHasEnded()
        {
            world.CarryConsumable(DungeonTestWorld.ReturnStone);
            world.Do(DungeonCommand.UseQuickConsumable());
            var turnAtEnd = world.Run.Turn;

            var result = world.Do(DungeonCommand.Move(GridPos.Right));

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(world.Run.Turn, Is.EqualTo(turnAtEnd));
        }

        [Test]
        public void PressingCWithNothingBoundIsRefused()
        {
            var result = world.Do(DungeonCommand.UseQuickConsumable());

            Assert.That(result.ConsumedTurn, Is.False);
        }
    }
}
