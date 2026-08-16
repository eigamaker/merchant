namespace Merchan.Domain
{
    /// <summary>
    /// Keeps the five quick slots, the held selection and the quick-consumable
    /// pick pointing at items that actually exist in the bag.
    ///
    /// None of these operations costs a dungeon turn: selecting a slot or
    /// re-binding one is bookkeeping, not an action.
    /// </summary>
    public sealed class QuickSlotService
    {
        private readonly ItemLedger ledger;
        private readonly InventoryState inventory;
        private readonly IItemCatalog catalog;

        public QuickSlotService(ItemLedger ledger, InventoryState inventory, IItemCatalog catalog)
        {
            this.ledger = ledger;
            this.inventory = inventory;
            this.catalog = catalog;
        }

        /// <summary>Binds a bag item to a slot. Binding the same item twice moves
        /// it rather than duplicating the reference.</summary>
        public bool TryAssign(int slotIndex, string uuid)
        {
            if (!IsValidSlot(slotIndex)) return false;
            if (!ledger.TryGet(uuid, out var item)) return false;
            if (item.Location.Place != ItemPlace.PlayerBag) return false;

            for (var i = 0; i < inventory.QuickSlots.Length; i++)
                if (inventory.QuickSlots[i] == uuid)
                    inventory.QuickSlots[i] = null;

            inventory.QuickSlots[slotIndex] = uuid;
            return true;
        }

        public void Clear(int slotIndex)
        {
            if (IsValidSlot(slotIndex)) inventory.QuickSlots[slotIndex] = null;
        }

        public void Select(int slotIndex)
        {
            if (IsValidSlot(slotIndex)) inventory.SelectedQuickSlot = slotIndex;
        }

        /// <summary>Mouse-wheel style cycling. Wraps in both directions.</summary>
        public void SelectRelative(int delta)
        {
            var count = inventory.QuickSlots.Length;
            var next = (inventory.SelectedQuickSlot + delta) % count;
            if (next < 0) next += count;
            inventory.SelectedQuickSlot = next;
        }

        public ItemInstance Held()
        {
            return ledger.Get(inventory.HeldUuid);
        }

        public ItemInstance AtSlot(int slotIndex)
        {
            return IsValidSlot(slotIndex) ? ledger.Get(inventory.QuickSlots[slotIndex]) : null;
        }

        public bool TrySetQuickConsumable(string uuid)
        {
            if (!ledger.TryGet(uuid, out var item)) return false;
            if (item.Location.Place != ItemPlace.PlayerBag) return false;
            if (!catalog.TryGet(item.DefinitionId, out var definition)) return false;
            if (definition.Category != ItemCategory.Consumable) return false;

            inventory.QuickConsumableUuid = uuid;
            return true;
        }

        public ItemInstance QuickConsumable()
        {
            return ledger.Get(inventory.QuickConsumableUuid);
        }

        /// <summary>
        /// Called by <see cref="InventoryService"/> whenever an item stops being
        /// in the bag — sold, shelved, consumed, dropped or merged away. Slots
        /// that referenced it are emptied so nothing points at an item the player
        /// no longer carries.
        ///
        /// A spent quick consumable re-links to another stack of the same kind, so
        /// using the last smoke bomb of one stack does not silently unbind `C`.
        /// </summary>
        internal void ForgetItem(ItemInstance item)
        {
            for (var i = 0; i < inventory.QuickSlots.Length; i++)
                if (inventory.QuickSlots[i] == item.Uuid)
                    inventory.QuickSlots[i] = null;

            if (inventory.QuickConsumableUuid != item.Uuid) return;

            inventory.QuickConsumableUuid = null;
            foreach (var candidate in ledger.InBag())
            {
                if (candidate.Uuid == item.Uuid) continue;
                if (candidate.DefinitionId != item.DefinitionId) continue;
                inventory.QuickConsumableUuid = candidate.Uuid;
                return;
            }
        }

        private static bool IsValidSlot(int slotIndex)
        {
            return slotIndex >= 0 && slotIndex < InventoryState.QuickSlotCount;
        }
    }
}
