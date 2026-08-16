using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// Guards the content set against the mistakes that only show up mid-run:
    /// a loot table naming an item that does not exist, or an escort the merchant
    /// can out-fight.
    /// </summary>
    public sealed class StarterContentTests
    {
        [Test]
        public void EveryPortedItemIsUsable()
        {
            var catalog = StarterContent.Items();

            Assert.That(catalog.All.Count(), Is.EqualTo(43), "40 ported wares plus three consumables");
            foreach (var definition in catalog.All)
            {
                Assert.That(definition.Id, Is.Not.Empty);
                Assert.That(definition.Bulk, Is.InRange(1, 3), $"{definition.Id} has an out-of-range bulk");
                Assert.That(definition.BaseValue, Is.GreaterThan(0), $"{definition.Id} is worthless");
                Assert.That(definition.NameFor(KnowledgeLevel.Unknown), Is.Not.Empty);
            }
        }

        [Test]
        public void OnlyMaterialsAndConsumablesStack()
        {
            foreach (var definition in StarterContent.Items().All.Where(d => d.Stackable))
                Assert.That(definition.Category, Is.EqualTo(ItemCategory.Material).Or.EqualTo(ItemCategory.Consumable), $"{definition.Id} should not stack");
        }

        [Test]
        public void NoUniquePieceStacks()
        {
            foreach (var definition in StarterContent.Items().All.Where(d => d.Unique))
                Assert.That(definition.Stackable, Is.False, $"{definition.Id} is one of a kind");
        }

        [Test]
        public void EveryLootTableEntryNamesARealItem()
        {
            var catalog = StarterContent.Items();
            var tables = StarterContent.LootTables();

            foreach (var enemy in StarterContent.Enemies())
            {
                Assert.That(tables.TryGet(enemy.LootTableId, out var table), Is.True, $"{enemy.Id} points at a missing loot table");
                foreach (var entry in table.Entries.Where(e => !e.IsNothing))
                    Assert.That(catalog.TryGet(entry.DefinitionId, out _), Is.True, $"{table.Id} drops unknown item {entry.DefinitionId}");
            }
        }

        [Test]
        public void EveryRemnantCanComeUpEmpty()
        {
            var tables = StarterContent.LootTables();

            foreach (var enemy in StarterContent.Enemies())
            {
                tables.TryGet(enemy.LootTableId, out var table);
                Assert.That(table.Entries.Any(e => e.IsNothing), Is.True, $"{table.Id} always pays out, which makes searching automatic");
            }
        }

        [Test]
        public void TheMerchantsWeaponIsWeakerThanAnyEscort()
        {
            var dagger = StarterContent.Items().Get("notched-dagger");

            Assert.That(dagger.IsWeapon, Is.True, "the merchant needs one thing to swing in an emergency");
            foreach (var guard in StarterContent.Guards())
                Assert.That(dagger.Power, Is.LessThanOrEqualTo(guard.Damage), $"the dagger must not outclass {guard.Name}");
        }

        [Test]
        public void OnlyTheDaggerIsAWeaponTheMerchantCanSwing()
        {
            var swingable = StarterContent.Items().All.Where(d => d.IsWeapon).Select(d => d.Id).ToList();

            Assert.That(swingable, Is.EqualTo(new[] { "notched-dagger" }), "the rest of the swords are merchandise, not equipment");
        }

        [Test]
        public void EachConsumableActuallyDoesSomething()
        {
            var catalog = StarterContent.Items();

            foreach (var id in new[] { StarterContent.SmokeBomb, StarterContent.Salve, StarterContent.ReturnStone })
            {
                var definition = catalog.Get(id);
                Assert.That(definition.Category, Is.EqualTo(ItemCategory.Consumable));
                Assert.That(definition.Effect, Is.Not.EqualTo(ConsumableEffect.None), $"{id} has no effect");
            }
        }

        [Test]
        public void PushResistanceFormsALadderTheMerchantCanLearn()
        {
            var enemies = StarterContent.Enemies();
            var strongestEscort = StarterContent.Guards().Max(g => g.PushPower);

            Assert.That(enemies.Any(e => e.PushResistance <= PlayerActionResolver.PlayerPushPower), Is.True,
                "the merchant needs at least one thing they can shove unaided");

            Assert.That(enemies.Any(e => e.PushResistance > PlayerActionResolver.PlayerPushPower && e.PushResistance <= strongestEscort), Is.True,
                "and at least one that shows why an escort is worth hiring");

            Assert.That(enemies.Count(e => e.PushResistance <= PlayerActionResolver.PlayerPushPower), Is.LessThan(enemies.Count),
                "shoving must not be a universal answer");
        }

        [Test]
        public void OnlyDeliberatelyRootedEnemiesResistEveryone()
        {
            var strongestEscort = StarterContent.Guards().Max(g => g.PushPower);

            foreach (var enemy in StarterContent.Enemies().Where(e => e.PushResistance > strongestEscort))
                Assert.That(enemy.PushResistance, Is.EqualTo(StarterContent.RootedInPlace),
                    $"{enemy.Name} is unshovable by accident; use RootedInPlace if that is the intent");
        }

        [Test]
        public void TheContentSetDrivesARealExpedition()
        {
            var catalog = StarterContent.Items();
            var ledger = new ItemLedger();
            var inventoryState = new InventoryState();
            var quickSlots = new QuickSlotService(ledger, inventoryState, catalog);
            var items = new InventoryService(ledger, inventoryState, catalog, quickSlots);
            var state = new GameState(ledger, inventoryState) { Mode = GameMode.Dungeon };
            var loot = new LootService(ledger, StarterContent.LootTables(), items, state);

            var map = GridMap.FromRows(new[] { "#####", "#...#", "#####" }, new GridPos(1, 1), new GridPos(3, 1));
            var run = new DungeonRunState(map, 42, 1, new PlayerActor(new GridPos(1, 1)));
            var slime = new EnemyActor("slime-1", StarterContent.Enemies()[0], new GridPos(3, 1));
            run.Enemies.Add(slime);

            var events = new System.Collections.Generic.List<DungeonEvent>();
            slime.Hp = 0;
            loot.DefeatEnemy(run, slime, events);

            Assert.That(run.Containers.Count, Is.EqualTo(1));
            foreach (var item in loot.Contents(run.Containers[0]))
                Assert.That(catalog.TryGet(item.DefinitionId, out _), Is.True, "a remnant produced an item the catalogue does not know");
        }
    }
}
