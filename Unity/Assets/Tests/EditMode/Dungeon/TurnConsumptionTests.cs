using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// The core promise of the turn model: one command advances the world either
    /// once or not at all, and only the actions listed in the design doc advance
    /// it. Aiming, switching gear and refused commands are free.
    /// </summary>
    public sealed class TurnConsumptionTests
    {
        private DungeonTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new DungeonTestWorld();
        }

        [Test]
        public void TurningToFaceIsFree()
        {
            var before = world.Run.Turn;

            var result = world.Face(Facing.Left);

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(world.Run.Turn, Is.EqualTo(before));
            Assert.That(world.Player.Facing, Is.EqualTo(Facing.Left));
        }

        [Test]
        public void ASuccessfulStepAdvancesExactlyOneTurn()
        {
            var result = world.Move(Facing.Right);

            Assert.That(result.ConsumedTurn, Is.True);
            Assert.That(world.Run.Turn, Is.EqualTo(1));
            Assert.That(world.Player.Position, Is.EqualTo(new GridPos(4, 2)));
        }

        [Test]
        public void WalkingIntoAWallCostsNothing()
        {
            world.Run.PlacePlayer(new GridPos(1, 2));

            var result = world.Move(Facing.Left);

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(world.Run.Turn, Is.EqualTo(0));
            Assert.That(world.Player.Position, Is.EqualTo(new GridPos(1, 2)));
        }

        [Test]
        public void ABlockedStepStillAimsTheMerchant()
        {
            world.Run.PlacePlayer(new GridPos(1, 2));

            world.Move(Facing.Left);

            Assert.That(world.Player.Facing, Is.EqualTo(Facing.Left), "bumping a wall should leave you looking at it");
        }

        [Test]
        public void WalkingIntoAnEnemyCostsNothingAndDoesNotAttack()
        {
            var slime = world.AddEnemy(world.Slime, new GridPos(4, 2));

            var result = world.Move(Facing.Right);

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(slime.Hp, Is.EqualTo(world.Slime.MaxHp), "movement is never an attack");
            Assert.That(world.Player.Position, Is.EqualTo(new GridPos(3, 2)));
        }

        [Test]
        public void WalkingIntoTheEscortCostsNothing()
        {
            world.AddGuard(new GridPos(4, 2));

            var result = world.Move(Facing.Right);

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(world.Player.Position, Is.EqualTo(new GridPos(3, 2)));
        }

        [Test]
        public void WaitingAdvancesOneTurn()
        {
            var result = world.Do(DungeonCommand.Wait());

            Assert.That(result.ConsumedTurn, Is.True);
            Assert.That(world.Run.Turn, Is.EqualTo(1));
        }

        [Test]
        public void SwingingWithEmptyHandsIsRefused()
        {
            world.AddEnemy(world.Slime, new GridPos(4, 2));
            world.Face(Facing.Right);

            var result = world.Do(DungeonCommand.UseHeld());

            Assert.That(result.ConsumedTurn, Is.False, "the merchant never fights bare-handed");
            Assert.That(world.Run.Turn, Is.EqualTo(0));
        }

        [Test]
        public void SwingingAtEmptyAirIsRefused()
        {
            world.HoldWeapon();
            world.Face(Facing.Right);

            var result = world.Do(DungeonCommand.UseHeld());

            Assert.That(result.ConsumedTurn, Is.False);
        }

        [Test]
        public void ChangingQuickSlotsIsFree()
        {
            world.HoldWeapon();
            var before = world.Run.Turn;

            world.QuickSlots.SelectRelative(1);
            world.QuickSlots.SelectRelative(-1);

            Assert.That(world.Run.Turn, Is.EqualTo(before), "quick slots are bookkeeping, not an action");
        }

        [Test]
        public void ContextOnAnEmptyCellIsRefused()
        {
            world.Run.PlacePlayer(new GridPos(3, 2));
            world.Face(Facing.Up);

            var result = world.Do(DungeonCommand.Context());

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(world.Run.Turn, Is.EqualTo(0));
        }

        [Test]
        public void ShovingNothingIsRefusedAndDoesNotStartTheCooldown()
        {
            world.Face(Facing.Right);

            var result = world.Do(DungeonCommand.Shove());

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(world.Run.CanShove, Is.True, "a refused shove must not cost the cooldown");
        }

        [Test]
        public void EachCommandAdvancesTheTurnCounterByAtMostOne()
        {
            world.HoldWeapon();
            world.AddGuard(new GridPos(2, 2));
            world.AddEnemy(world.Orc, new GridPos(5, 3));

            var commands = new[]
            {
                DungeonCommand.Face(GridPos.Right),
                DungeonCommand.Move(GridPos.Right),
                DungeonCommand.Wait(),
                DungeonCommand.Move(GridPos.Up),
                DungeonCommand.Context(),
                DungeonCommand.Shove()
            };

            foreach (var command in commands)
            {
                var before = world.Run.Turn;
                var result = world.Do(command);
                var advanced = world.Run.Turn - before;

                Assert.That(advanced, Is.EqualTo(result.ConsumedTurn ? 1 : 0), $"{command.Kind} advanced {advanced} turns");
            }
        }
    }
}

