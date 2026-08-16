using System.Collections.Generic;

namespace Merchan.Domain
{
    public enum LedgerEntryKind
    {
        Found,
        Examined,
        Stored,
        Displayed,
        Sold,
        Returned,
        Consumed,
        Dropped
    }

    public sealed class LedgerEntry
    {
        public LedgerEntry(int day, LedgerEntryKind kind, string detail, int? value = null)
        {
            Day = day;
            Kind = kind;
            Detail = detail;
            Value = value;
        }

        public int Day { get; }

        public LedgerEntryKind Kind { get; }

        public string Detail { get; }

        public int? Value { get; }
    }

    /// <summary>
    /// One concrete object in the world. Location and ReservedBy are only
    /// writable from inside the domain assembly, because every move has to go
    /// through <see cref="InventoryService"/> for capacity, stacking and
    /// quick-slot bookkeeping to stay consistent.
    /// </summary>
    public sealed class ItemInstance
    {
        internal ItemInstance(int sequence, string uuid, string definitionId, int discoveredDay, int? discoveredFloor)
        {
            Sequence = sequence;
            Uuid = uuid;
            DefinitionId = definitionId;
            DiscoveredDay = discoveredDay;
            DiscoveredFloor = discoveredFloor;
            Quantity = 1;
            Knowledge = KnowledgeLevel.Unknown;
            Location = ItemLocation.Nowhere;
            Clues = new List<string>();
            History = new List<LedgerEntry>();
        }

        /// <summary>Creation order. Every listing sorts by this so the bag, the
        /// shelves and the save file enumerate identically on every run.</summary>
        public int Sequence { get; }

        public string Uuid { get; }

        public string DefinitionId { get; }

        public int DiscoveredDay { get; }

        public int? DiscoveredFloor { get; }

        public int Quantity { get; internal set; }

        public KnowledgeLevel Knowledge { get; internal set; }

        public ItemLocation Location { get; internal set; }

        /// <summary>Customer id that has claimed this ware. Set while a shopper is
        /// on its way to the shelf so two customers never target one item.</summary>
        public string ReservedBy { get; internal set; }

        /// <summary>Reserved for the durability rule, which the first vertical
        /// slice deliberately leaves unimplemented.</summary>
        public int? DurabilityRemaining { get; internal set; }

        public List<string> Clues { get; }

        public List<LedgerEntry> History { get; }

        public bool IsReserved => !string.IsNullOrEmpty(ReservedBy);

        /// <summary>
        /// Two instances merge only when this key matches. Provenance and
        /// appraisal state are part of it, so an identified relic never silently
        /// merges into a pile of unidentified ones.
        /// </summary>
        public string StackKey(ItemDefinition definition)
        {
            return definition.Stackable ? $"{DefinitionId}|{Knowledge}" : Uuid;
        }
    }
}
