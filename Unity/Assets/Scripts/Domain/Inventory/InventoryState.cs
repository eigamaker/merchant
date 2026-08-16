namespace Merchan.Domain
{
    /// <summary>
    /// The three-layer carry model: the bag holds everything, five quick slots
    /// shortcut into it, and one of those five is the held item that `F` acts
    /// with. Quick slots store uuids, never copies, so the same ItemInstance is
    /// referenced from both places.
    /// </summary>
    public sealed class InventoryState
    {
        public const int QuickSlotCount = 5;
        public const int DefaultSlotCapacity = 16;
        public const int DefaultBulkCapacity = 20;

        public InventoryState(int slotCapacity = DefaultSlotCapacity, int bulkCapacity = DefaultBulkCapacity)
        {
            SlotCapacity = slotCapacity;
            BulkCapacity = bulkCapacity;
            QuickSlots = new string[QuickSlotCount];
        }

        /// <summary>How many distinct stacks fit in the bag.</summary>
        public int SlotCapacity { get; set; }

        /// <summary>Total bulk the bag can hold. Bulk is counted once per stack,
        /// so a pouch of herbs costs the same as a single herb, while a statue
        /// costs three on its own.</summary>
        public int BulkCapacity { get; set; }

        /// <summary>Item uuids, or null for an empty slot.</summary>
        public string[] QuickSlots { get; }

        public int SelectedQuickSlot { get; internal set; }

        /// <summary>The stack `C` reaches for. Kept separate from the held item so
        /// a smoke bomb stays one keypress away while a weapon is in hand.</summary>
        public string QuickConsumableUuid { get; internal set; }

        public string HeldUuid => QuickSlots[SelectedQuickSlot];
    }
}
