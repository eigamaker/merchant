using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// A save has to bring back exactly where every item was. Losing a shelf slot
    /// or a customer's held ware would duplicate or delete stock across a reload,
    /// which is the failure the single-location model exists to prevent.
    /// </summary>
    public sealed class SaveRoundTripTests
    {
        private InventoryTestWorld world;
        private GameState state;

        [SetUp]
        public void SetUp()
        {
            world = new InventoryTestWorld();
            state = new GameState(world.Ledger, world.Inventory);
        }

        [Test]
        public void EveryItemComesBackInTheSamePlace()
        {
            var carried = world.SpawnInBag(InventoryTestWorld.Sword);
            var stored = world.SpawnInBag(InventoryTestWorld.Statue);
            world.Items.TryMove(stored.Uuid, ItemLocation.InShopStorage());
            var shelved = world.Spawn(InventoryTestWorld.Herb, ItemLocation.OnShelf("shelf-a", 2), quantity: 4);
            var dropped = world.SpawnOnGround(InventoryTestWorld.SmokeBomb, 6, 9, quantity: 2);
            world.Items.TryReserve(shelved.Uuid, "customer-1");

            var restored = SaveMapper.Restore(SaveMapper.Capture(state));

            Assert.That(restored.Items.Get(carried.Uuid).Location, Is.EqualTo(ItemLocation.InPlayerBag()));
            Assert.That(restored.Items.Get(stored.Uuid).Location, Is.EqualTo(ItemLocation.InShopStorage()));
            Assert.That(restored.Items.OnShelfSlot("shelf-a", 2).Uuid, Is.EqualTo(shelved.Uuid));
            Assert.That(restored.Items.OnGroundAt(new GridPos(6, 9)).Single().Uuid, Is.EqualTo(dropped.Uuid));
            Assert.That(restored.Items.Get(shelved.Uuid).ReservedBy, Is.EqualTo("customer-1"));
            Assert.That(restored.Items.Get(shelved.Uuid).Quantity, Is.EqualTo(4));
        }

        [Test]
        public void QuickSlotsAndTheHeldSelectionSurvive()
        {
            var sword = world.SpawnInBag(InventoryTestWorld.Sword);
            var bombs = world.SpawnInBag(InventoryTestWorld.SmokeBomb, quantity: 3);
            world.QuickSlots.TryAssign(2, sword.Uuid);
            world.QuickSlots.TryAssign(4, bombs.Uuid);
            world.QuickSlots.Select(2);
            world.QuickSlots.TrySetQuickConsumable(bombs.Uuid);

            var restored = SaveMapper.Restore(SaveMapper.Capture(state));

            Assert.That(restored.Inventory.QuickSlots[2], Is.EqualTo(sword.Uuid));
            Assert.That(restored.Inventory.QuickSlots[4], Is.EqualTo(bombs.Uuid));
            Assert.That(restored.Inventory.HeldUuid, Is.EqualTo(sword.Uuid));
            Assert.That(restored.Inventory.QuickConsumableUuid, Is.EqualTo(bombs.Uuid));
        }

        [Test]
        public void AQuickSlotPointingAtAMissingItemIsDroppedOnLoad()
        {
            var sword = world.SpawnInBag(InventoryTestWorld.Sword);
            world.QuickSlots.TryAssign(1, sword.Uuid);

            var save = SaveMapper.Capture(state);
            save.Items.RemoveAll(entry => entry.Uuid == sword.Uuid);

            var restored = SaveMapper.Restore(save);

            Assert.That(restored.Inventory.QuickSlots[1], Is.Null);
        }

        [Test]
        public void ANewItemAfterLoadingNeverReusesARestoredUuid()
        {
            world.SpawnInBag(InventoryTestWorld.Sword);
            world.SpawnInBag(InventoryTestWorld.Statue);

            var restored = SaveMapper.Restore(SaveMapper.Capture(state));
            var minted = restored.Items.Create(InventoryTestWorld.Herb, restored.Day, null, ItemLocation.InPlayerBag());

            Assert.That(restored.Items.All.Count(entry => entry.Uuid == minted.Uuid), Is.EqualTo(1));
            Assert.That(minted.Sequence, Is.EqualTo(3));
        }

        [Test]
        public void ProgressAndTheOncePerDayExpeditionFlagSurvive()
        {
            state.Day = 7;
            state.Gold = 1234;
            state.Hp = 5;
            state.Mode = GameMode.HomeShopOpen;
            state.ExpeditionUsedToday = true;

            var restored = SaveMapper.Restore(SaveMapper.Capture(state));

            Assert.That(restored.Day, Is.EqualTo(7));
            Assert.That(restored.Gold, Is.EqualTo(1234));
            Assert.That(restored.Hp, Is.EqualTo(5));
            Assert.That(restored.Mode, Is.EqualTo(GameMode.HomeShopOpen));
            Assert.That(restored.ExpeditionUsedToday, Is.True);
        }

        [Test]
        public void ProvenanceAndAppraisalHistorySurvive()
        {
            var relic = world.SpawnInBag(InventoryTestWorld.Statue);
            relic.Clues.Add("片目だけが赤い石でできている");
            relic.History.Add(new LedgerEntry(3, LedgerEntryKind.Found, "地下2階で発見"));
            world.Ledger.SetKnowledge(relic, KnowledgeLevel.Suspected, 4, "学者に見せた");

            var restored = SaveMapper.Restore(SaveMapper.Capture(state)).Items.Get(relic.Uuid);

            Assert.That(restored.Knowledge, Is.EqualTo(KnowledgeLevel.Suspected));
            Assert.That(restored.Clues, Is.EqualTo(new[] { "片目だけが赤い石でできている" }));
            Assert.That(restored.History.Select(entry => entry.Kind), Is.EqualTo(new[] { LedgerEntryKind.Found, LedgerEntryKind.Examined }));
            Assert.That(restored.History[1].Detail, Is.EqualTo("学者に見せた"));
        }

        [Test]
        public void AnUnknownSaveVersionIsRefusedRatherThanGuessedAt()
        {
            var save = SaveMapper.Capture(state);
            save.Version = 99;

            Assert.That(() => SaveMapper.Restore(save), Throws.TypeOf<System.NotSupportedException>());
        }
    }
}
