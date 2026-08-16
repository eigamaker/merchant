using System.Collections.Generic;

namespace Merchan.Domain
{
    public enum MoveRejection
    {
        None,
        UnknownItem,
        UnknownDefinition,
        NoBagSlot,
        NoBagBulk,
        Reserved,
        ShelfSlotOccupied,
        AlreadyThere,
        Archived
    }

    public readonly struct MoveResult
    {
        private MoveResult(bool success, MoveRejection rejection, string resultUuid, bool merged)
        {
            Success = success;
            Rejection = rejection;
            ResultUuid = resultUuid;
            Merged = merged;
        }

        public bool Success { get; }

        public MoveRejection Rejection { get; }

        /// <summary>The uuid the item now lives under. It differs from the moved
        /// uuid when the stack merged into one already in the bag, and callers
        /// that kept the old uuid must stop using it.</summary>
        public string ResultUuid { get; }

        public bool Merged { get; }

        internal static MoveResult Moved(string uuid) => new MoveResult(true, MoveRejection.None, uuid, false);

        internal static MoveResult MergedInto(string uuid) => new MoveResult(true, MoveRejection.None, uuid, true);

        internal static MoveResult Rejected(MoveRejection rejection) => new MoveResult(false, rejection, null, false);
    }

    /// <summary>
    /// The only way an item changes hands. Capacity, stacking, reservations and
    /// quick-slot cleanup all happen here, so no caller can move an item and
    /// leave one of them stale.
    /// </summary>
    public sealed class InventoryService
    {
        private readonly ItemLedger ledger;
        private readonly InventoryState inventory;
        private readonly IItemCatalog catalog;
        private readonly QuickSlotService quickSlots;

        public InventoryService(ItemLedger ledger, InventoryState inventory, IItemCatalog catalog, QuickSlotService quickSlots)
        {
            this.ledger = ledger;
            this.inventory = inventory;
            this.catalog = catalog;
            this.quickSlots = quickSlots;
        }

        /// <summary>Number of distinct stacks carried.</summary>
        public int UsedBagSlots
        {
            get
            {
                var used = 0;
                foreach (var _ in ledger.InBag()) used++;
                return used;
            }
        }

        /// <summary>Bulk counted once per stack. See <see cref="InventoryState.BulkCapacity"/>.</summary>
        public int UsedBagBulk
        {
            get
            {
                var used = 0;
                foreach (var item in ledger.InBag())
                    if (catalog.TryGet(item.DefinitionId, out var definition))
                        used += definition.Bulk;
                return used;
            }
        }

        public bool BagHasRoomFor(string definitionId)
        {
            if (!catalog.TryGet(definitionId, out var definition)) return false;
            return UsedBagSlots < inventory.SlotCapacity && UsedBagBulk + definition.Bulk <= inventory.BulkCapacity;
        }

        public MoveResult TryPickUp(string uuid) => TryMove(uuid, ItemLocation.InPlayerBag());

        public MoveResult TryMove(string uuid, ItemLocation destination)
        {
            if (!ledger.TryGet(uuid, out var item)) return MoveResult.Rejected(MoveRejection.UnknownItem);
            if (!catalog.TryGet(item.DefinitionId, out var definition)) return MoveResult.Rejected(MoveRejection.UnknownDefinition);
            if (item.Location.IsArchived) return MoveResult.Rejected(MoveRejection.Archived);
            if (item.Location == destination) return MoveResult.Rejected(MoveRejection.AlreadyThere);

            // A reserved ware is spoken for. Only the customer who claimed it may
            // pick it up; anything else has to release the claim first.
            if (item.IsReserved
                && !(destination.Place == ItemPlace.CustomerHeld && destination.ContainerId == item.ReservedBy))
                return MoveResult.Rejected(MoveRejection.Reserved);

            if (destination.Place == ItemPlace.ShelfSlot
                && ledger.OnShelfSlot(destination.ContainerId, destination.SlotIndex) != null)
                return MoveResult.Rejected(MoveRejection.ShelfSlotOccupied);

            if (destination.Place == ItemPlace.PlayerBag)
                return MoveIntoBag(item, definition);

            var leftBag = item.Location.Place == ItemPlace.PlayerBag;
            ledger.SetLocation(item, destination);
            if (leftBag) quickSlots.ForgetItem(item);
            if (destination.Place == ItemPlace.CustomerHeld) item.ReservedBy = null;
            return MoveResult.Moved(item.Uuid);
        }

        private MoveResult MoveIntoBag(ItemInstance item, ItemDefinition definition)
        {
            var mergeTarget = FindMergeTarget(item, definition);
            if (mergeTarget != null)
            {
                // Merging costs no slot and no bulk, so a full bag can still absorb
                // one more herb into a pouch it already carries.
                mergeTarget.Quantity += item.Quantity;
                quickSlots.ForgetItem(item);
                ledger.Forget(item);
                return MoveResult.MergedInto(mergeTarget.Uuid);
            }

            if (UsedBagSlots >= inventory.SlotCapacity) return MoveResult.Rejected(MoveRejection.NoBagSlot);
            if (UsedBagBulk + definition.Bulk > inventory.BulkCapacity) return MoveResult.Rejected(MoveRejection.NoBagBulk);

            ledger.SetLocation(item, ItemLocation.InPlayerBag());
            return MoveResult.Moved(item.Uuid);
        }

        private ItemInstance FindMergeTarget(ItemInstance item, ItemDefinition definition)
        {
            if (!definition.Stackable) return null;

            var key = item.StackKey(definition);
            foreach (var candidate in ledger.InBag())
            {
                if (candidate.Uuid == item.Uuid) continue;
                if (candidate.IsReserved) continue;
                if (candidate.StackKey(definition) != key) continue;
                if (candidate.Quantity + item.Quantity > definition.MaxStack) continue;
                return candidate;
            }
            return null;
        }

        public bool TryReserve(string uuid, string customerId)
        {
            if (string.IsNullOrEmpty(customerId)) return false;
            if (!ledger.TryGet(uuid, out var item)) return false;
            if (item.IsReserved) return false;

            item.ReservedBy = customerId;
            return true;
        }

        public void ReleaseReservation(string uuid)
        {
            if (ledger.TryGet(uuid, out var item)) item.ReservedBy = null;
        }

        /// <summary>
        /// Spends part of a stack. The instance disappears once the last unit is
        /// used, and every quick slot that pointed at it is cleared.
        /// </summary>
        public bool TryConsume(string uuid, int quantity = 1)
        {
            if (quantity < 1) return false;
            if (!ledger.TryGet(uuid, out var item)) return false;
            if (item.Quantity < quantity) return false;

            item.Quantity -= quantity;
            if (item.Quantity > 0) return true;

            Destroy(item);
            return true;
        }

        /// <summary>Removes an item from play entirely. Selling and quest turn-in
        /// use <see cref="TryMove"/> into an archive location instead, because
        /// those items must stay readable in the ledger UI.</summary>
        public void Destroy(string uuid)
        {
            if (ledger.TryGet(uuid, out var item)) Destroy(item);
        }

        private void Destroy(ItemInstance item)
        {
            quickSlots.ForgetItem(item);
            ledger.Forget(item);
        }

        /// <summary>
        /// Every place that currently holds at least one item, with its contents.
        /// Used by the invariant tests and by the save writer.
        /// </summary>
        public IReadOnlyDictionary<ItemLocation, List<ItemInstance>> Snapshot()
        {
            var snapshot = new Dictionary<ItemLocation, List<ItemInstance>>();
            foreach (var item in ledger.All)
            {
                if (!snapshot.TryGetValue(item.Location, out var bucket))
                {
                    bucket = new List<ItemInstance>();
                    snapshot[item.Location] = bucket;
                }
                bucket.Add(item);
            }
            return snapshot;
        }
    }
}
