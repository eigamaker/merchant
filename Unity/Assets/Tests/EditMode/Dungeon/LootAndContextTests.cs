using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// Defeating something leaves one searchable remnant and never scatters loot
    /// on the floor, and `E` resolves without ever opening a shared action menu.
    /// </summary>
    public sealed class LootAndContextTests
    {
        private DungeonTestWorld world;

        [SetUp]
        public void SetUp()
        {
            world = new DungeonTestWorld();
        }

        private EnemyActor KillWithDagger(GridPos at)
        {
            world.HoldWeapon();
            var slime = world.AddEnemy(world.Slime, at);
            world.Face(FacingExtensions.FromStep(at - world.Player.Position, Facing.Right));
            world.Do(DungeonCommand.UseHeld());
            return slime;
        }

        [Test]
        public void ADefeatLeavesExactlyOneRemnantAndNothingOnTheFloor()
        {
            var slime = KillWithDagger(new GridPos(4, 2));

            Assert.That(world.Run.Enemies, Has.No.Member(slime));
            Assert.That(world.Run.Containers.Count, Is.EqualTo(1));
            Assert.That(world.Run.Containers[0].Kind, Is.EqualTo(ContainerKind.Remnant));
            Assert.That(world.Run.Containers[0].Position, Is.EqualTo(new GridPos(4, 2)));
            Assert.That(world.Ledger.At(ItemPlace.DungeonGround), Is.Empty, "a body never drops loot directly");
        }

        [Test]
        public void RemnantContentsAreHeldInTheContainerUntilTakenOut()
        {
            KillWithDagger(new GridPos(4, 2));
            var remnant = world.Run.Containers[0];

            var contents = world.Loot.Contents(remnant);

            Assert.That(contents.Count, Is.EqualTo(1));
            Assert.That(contents[0].DefinitionId, Is.EqualTo(DungeonTestWorld.Herb));
            Assert.That(contents[0].Location, Is.EqualTo(ItemLocation.InDungeonContainer(remnant.Id)));
            Assert.That(world.Ledger.InBag().Any(i => i.DefinitionId == DungeonTestWorld.Herb), Is.False);
        }

        [Test]
        public void SearchingCostsATurnAndTakingCostsAnother()
        {
            KillWithDagger(new GridPos(4, 2));
            var remnant = world.Run.Containers[0];
            var turnAfterKill = world.Run.Turn;

            var search = world.Do(DungeonCommand.Context());
            Assert.That(search.ConsumedTurn, Is.True);
            Assert.That(remnant.Searched, Is.True);
            Assert.That(world.Run.Turn, Is.EqualTo(turnAfterKill + 1));

            var take = world.Do(DungeonCommand.Context());
            Assert.That(take.ConsumedTurn, Is.True);
            Assert.That(world.Run.Turn, Is.EqualTo(turnAfterKill + 2));
            Assert.That(world.Ledger.InBag().Any(i => i.DefinitionId == DungeonTestWorld.Herb), Is.True);
            Assert.That(world.Loot.Contents(remnant), Is.Empty);
        }

        [Test]
        public void AnEmptyRemnantIsARealOutcome()
        {
            world.HoldWeapon();
            var tough = new EnemyDefinition("husk", "抜け殻", maxHp: 2, damage: 1, chaseRange: 6, pushResistance: 9, lootTableId: "always-nothing");
            world.AddEnemy(tough, new GridPos(4, 2));
            world.Face(Facing.Right);
            world.Do(DungeonCommand.UseHeld());

            var remnant = world.Run.Containers[0];
            world.Do(DungeonCommand.Context());

            Assert.That(remnant.Searched, Is.True);
            Assert.That(world.Loot.Contents(remnant), Is.Empty, "searching has to be able to come up with nothing");
        }

        [Test]
        public void AnUnsearchedRemnantCannotBeLootedThroughTheContainer()
        {
            KillWithDagger(new GridPos(4, 2));
            var remnant = world.Run.Containers[0];
            var hidden = world.Loot.Contents(remnant)[0];

            var events = new System.Collections.Generic.List<DungeonEvent>();
            Assert.That(world.Loot.TryTake(remnant, hidden.Uuid, events), Is.False);
            Assert.That(hidden.Location, Is.EqualTo(ItemLocation.InDungeonContainer(remnant.Id)));
        }

        [Test]
        public void TheCellInFrontIsOfferedBeforeTheCellUnderfoot()
        {
            world.Run.PlacePlayer(new GridPos(3, 2));
            world.Ledger.Create(DungeonTestWorld.Herb, 1, 1, ItemLocation.OnDungeonGround(new GridPos(3, 2)));
            world.Ledger.Create(DungeonTestWorld.Dagger, 1, 1, ItemLocation.OnDungeonGround(new GridPos(4, 2)));
            world.Face(Facing.Right);

            var prompts = world.Prompts();

            Assert.That(prompts[0].Cell, Is.EqualTo(new GridPos(4, 2)), "what you are looking at wins");
        }

        [Test]
        public void AnUnsearchedRemnantOutranksAFloorItemInTheSameCell()
        {
            KillWithDagger(new GridPos(4, 2));
            world.Ledger.Create(DungeonTestWorld.Herb, 1, 1, ItemLocation.OnDungeonGround(new GridPos(4, 2)));

            var prompts = world.Prompts();

            Assert.That(prompts[0].Kind, Is.EqualTo(ContextActionKind.SearchRemnant));
            Assert.That(prompts.Count(p => p.Cell == new GridPos(4, 2)), Is.EqualTo(2), "both are offered, the remnant first");
        }

        [Test]
        public void PickingUpBeatsLeavingWhenBothSitOnTheEntrance()
        {
            world.Run.PlacePlayer(world.Run.Map.Entrance);
            world.Ledger.Create(DungeonTestWorld.Herb, 1, 1, ItemLocation.OnDungeonGround(world.Run.Map.Entrance));
            world.Face(Facing.Down);

            var prompts = world.Prompts();

            Assert.That(prompts[0].Kind, Is.EqualTo(ContextActionKind.PickUpGround));
            Assert.That(prompts.Any(p => p.Kind == ContextActionKind.LeaveDungeon), Is.True, "leaving is still reachable from the chooser");
        }

        [Test]
        public void TheChooserCanPickSomethingOtherThanTheDefault()
        {
            KillWithDagger(new GridPos(4, 2));
            var floorItem = world.Ledger.Create(DungeonTestWorld.Herb, 1, 1, ItemLocation.OnDungeonGround(new GridPos(4, 2)));

            var result = world.Do(DungeonCommand.Context(itemUuid: floorItem.Uuid));

            Assert.That(result.ConsumedTurn, Is.True);
            Assert.That(world.Run.Containers[0].Searched, Is.False, "the remnant was passed over");
            Assert.That(world.Ledger.Contains(floorItem.Uuid) && floorItem.Location == ItemLocation.InPlayerBag(), Is.True);
        }

        [Test]
        public void AFullBagRefusesThePickupAndCostsNoTurn()
        {
            world.Inventory.SlotCapacity = 0;
            world.Ledger.Create(DungeonTestWorld.Herb, 1, 1, ItemLocation.OnDungeonGround(new GridPos(4, 2)));
            world.Face(Facing.Right);

            var result = world.Do(DungeonCommand.Context());

            Assert.That(result.ConsumedTurn, Is.False);
            Assert.That(world.Run.Turn, Is.EqualTo(0));
        }

        [Test]
        public void WalkingOutOfTheEntranceEndsTheExpedition()
        {
            world.Run.PlacePlayer(world.Run.Map.Entrance);
            world.Face(Facing.Down);

            var result = world.Do(DungeonCommand.Context());

            Assert.That(result.ConsumedTurn, Is.True);
            Assert.That(world.Run.Outcome, Is.EqualTo(RunOutcome.Returned));
            Assert.That(result.Events.Any(e => e.Kind == DungeonEventKind.LeftDungeon), Is.True);
        }
    }
}
