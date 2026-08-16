using System;
using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Converts between live game state and the save DTOs. Kept as pure
    /// functions so a round trip is testable without touching the file system
    /// or a JSON library.
    /// </summary>
    public static class SaveMapper
    {
        /// <summary>
        /// The roster is passed in rather than held on <see cref="GameState"/>: the
        /// escorts' history is its own concern, and the rules only ever reach it
        /// through <see cref="GuardRoster"/>.
        /// </summary>
        public static SaveGameV1 Capture(GameState state, GuardRoster roster = null)
        {
            var save = new SaveGameV1
            {
                Version = GameState.SaveVersion,
                Day = state.Day,
                Gold = state.Gold,
                Hp = state.Hp,
                MaxHp = state.MaxHp,
                Mode = state.Mode.ToString(),
                ExpeditionUsedToday = state.ExpeditionUsedToday,
                HiredGuardId = state.HiredGuardId,
                HiredGuardFee = state.HiredGuardFee,
                Inventory = new SaveInventory
                {
                    SlotCapacity = state.Inventory.SlotCapacity,
                    BulkCapacity = state.Inventory.BulkCapacity,
                    QuickSlots = (string[])state.Inventory.QuickSlots.Clone(),
                    SelectedQuickSlot = state.Inventory.SelectedQuickSlot,
                    QuickConsumableUuid = state.Inventory.QuickConsumableUuid
                }
            };

            foreach (var item in state.Items.All)
                save.Items.Add(CaptureItem(item));

            if (roster != null)
            {
                foreach (var record in roster.Records)
                    save.Guards.Add(new SaveGuard
                    {
                        GuardId = record.GuardId,
                        Unlocked = record.Unlocked,
                        Relation = record.Relation,
                        Experience = record.Experience,
                        Level = record.Level,
                        InjuredUntilDay = record.InjuredUntilDay
                    });
            }

            return save;
        }

        /// <summary>
        /// The escort history from a save, ready to hand to a new
        /// <see cref="GuardRoster"/>. Records for escorts the content set no longer
        /// defines are dropped by the roster itself.
        /// </summary>
        public static IReadOnlyList<GuardRecord> RestoreGuards(SaveGameV1 save)
        {
            var records = new List<GuardRecord>();
            if (save?.Guards == null) return records;

            foreach (var saved in save.Guards)
            {
                records.Add(new GuardRecord(saved.GuardId, saved.Unlocked)
                {
                    Relation = saved.Relation,
                    Experience = saved.Experience,
                    Level = saved.Level < 1 ? 1 : saved.Level,
                    InjuredUntilDay = saved.InjuredUntilDay
                });
            }
            return records;
        }

        public static GameState Restore(SaveGameV1 save)
        {
            if (save == null) throw new ArgumentNullException(nameof(save));
            if (save.Version != GameState.SaveVersion)
                throw new NotSupportedException($"Unsupported save version {save.Version}; expected {GameState.SaveVersion}.");

            var ledger = new ItemLedger();
            var inventory = new InventoryState(save.Inventory.SlotCapacity, save.Inventory.BulkCapacity);
            var state = new GameState(ledger, inventory)
            {
                Day = save.Day,
                Gold = save.Gold,
                Hp = save.Hp,
                MaxHp = save.MaxHp,
                Mode = ParseEnum(save.Mode, GameMode.HomeShopClosed),
                ExpeditionUsedToday = save.ExpeditionUsedToday,
                HiredGuardId = string.IsNullOrEmpty(save.HiredGuardId) ? null : save.HiredGuardId,
                HiredGuardFee = save.HiredGuardFee
            };

            foreach (var saved in save.Items)
                RestoreItem(ledger, saved);

            // Quick slots are restored after the items so a stale uuid — one whose
            // item no longer exists in the save — drops out instead of becoming a
            // shortcut to nothing.
            var slots = save.Inventory.QuickSlots ?? new string[InventoryState.QuickSlotCount];
            for (var i = 0; i < inventory.QuickSlots.Length && i < slots.Length; i++)
                inventory.QuickSlots[i] = ledger.Contains(slots[i]) ? slots[i] : null;

            inventory.SelectedQuickSlot = save.Inventory.SelectedQuickSlot >= 0 && save.Inventory.SelectedQuickSlot < InventoryState.QuickSlotCount
                ? save.Inventory.SelectedQuickSlot
                : 0;
            inventory.QuickConsumableUuid = ledger.Contains(save.Inventory.QuickConsumableUuid) ? save.Inventory.QuickConsumableUuid : null;

            return state;
        }

        private static SaveItem CaptureItem(ItemInstance item)
        {
            var saved = new SaveItem
            {
                Sequence = item.Sequence,
                Uuid = item.Uuid,
                DefinitionId = item.DefinitionId,
                Quantity = item.Quantity,
                Knowledge = item.Knowledge.ToString(),
                DiscoveredDay = item.DiscoveredDay,
                DiscoveredFloor = item.DiscoveredFloor ?? -1,
                ReservedBy = item.ReservedBy,
                Location = new SaveItemLocation
                {
                    Place = item.Location.Place.ToString(),
                    CellX = item.Location.Cell.X,
                    CellY = item.Location.Cell.Y,
                    ContainerId = item.Location.ContainerId,
                    SlotIndex = item.Location.SlotIndex
                }
            };

            saved.Clues.AddRange(item.Clues);
            foreach (var entry in item.History)
                saved.History.Add(new SaveLedgerEntry
                {
                    Day = entry.Day,
                    Kind = entry.Kind.ToString(),
                    Detail = entry.Detail,
                    Value = entry.Value ?? -1,
                    HasValue = entry.Value.HasValue
                });

            return saved;
        }

        private static void RestoreItem(ItemLedger ledger, SaveItem saved)
        {
            var item = ledger.Restore(
                saved.Sequence,
                saved.Uuid,
                saved.DefinitionId,
                saved.DiscoveredDay,
                saved.DiscoveredFloor < 0 ? (int?)null : saved.DiscoveredFloor,
                saved.Quantity,
                ParseEnum(saved.Knowledge, KnowledgeLevel.Unknown),
                RestoreLocation(saved.Location),
                saved.ReservedBy);

            if (saved.Clues != null) item.Clues.AddRange(saved.Clues);
            if (saved.History == null) return;

            foreach (var entry in saved.History)
                item.History.Add(new LedgerEntry(
                    entry.Day,
                    ParseEnum(entry.Kind, LedgerEntryKind.Found),
                    entry.Detail,
                    entry.HasValue ? entry.Value : (int?)null));
        }

        private static ItemLocation RestoreLocation(SaveItemLocation saved)
        {
            if (saved == null) return ItemLocation.Nowhere;

            switch (ParseEnum(saved.Place, ItemPlace.Nowhere))
            {
                case ItemPlace.DungeonGround: return ItemLocation.OnDungeonGround(new GridPos(saved.CellX, saved.CellY));
                case ItemPlace.DungeonContainer: return ItemLocation.InDungeonContainer(saved.ContainerId);
                case ItemPlace.PlayerBag: return ItemLocation.InPlayerBag();
                case ItemPlace.ShopStorage: return ItemLocation.InShopStorage();
                case ItemPlace.ShelfSlot: return ItemLocation.OnShelf(saved.ContainerId, saved.SlotIndex);
                case ItemPlace.CustomerHeld: return ItemLocation.HeldByCustomer(saved.ContainerId);
                case ItemPlace.SoldArchive: return ItemLocation.Sold();
                case ItemPlace.QuestReturned: return ItemLocation.ReturnedToQuestGiver();
                default: return ItemLocation.Nowhere;
            }
        }

        private static TEnum ParseEnum<TEnum>(string value, TEnum fallback) where TEnum : struct
        {
            return Enum.TryParse<TEnum>(value, out var parsed) ? parsed : fallback;
        }
    }
}
