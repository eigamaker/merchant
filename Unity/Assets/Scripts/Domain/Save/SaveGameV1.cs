using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// The on-disk shape of a save. These are plain data holders with public
    /// fields and no attributes, so the domain stays free of any JSON library:
    /// the Unity layer picks the serializer (Newtonsoft) and this assembly only
    /// decides what is worth writing.
    ///
    /// Browser saves (GameState.version 3) are not read. They assume a town that
    /// no longer exists in the design, so there is nothing meaningful to migrate.
    /// </summary>
    public sealed class SaveGameV1
    {
        public int Version = GameState.SaveVersion;
        public int Day;
        public int Gold;
        public int Hp;
        public int MaxHp;
        public string Mode;
        public bool ExpeditionUsedToday;
        public string HiredGuardId;
        public int HiredGuardFee;
        public SaveInventory Inventory = new SaveInventory();
        public List<SaveItem> Items = new List<SaveItem>();
        public List<SaveGuard> Guards = new List<SaveGuard>();
    }

    public sealed class SaveGuard
    {
        public string GuardId;
        public bool Unlocked;
        public int Relation;
        public int Experience;
        public int Level;
        public int InjuredUntilDay;
    }

    public sealed class SaveInventory
    {
        public int SlotCapacity;
        public int BulkCapacity;
        public string[] QuickSlots;
        public int SelectedQuickSlot;
        public string QuickConsumableUuid;
    }

    public sealed class SaveItem
    {
        public int Sequence;
        public string Uuid;
        public string DefinitionId;
        public int Quantity;
        public string Knowledge;
        public int DiscoveredDay;
        public int DiscoveredFloor = -1;
        public string ReservedBy;
        public SaveItemLocation Location = new SaveItemLocation();
        public List<string> Clues = new List<string>();
        public List<SaveLedgerEntry> History = new List<SaveLedgerEntry>();
    }

    /// <summary>Flat because <see cref="ItemLocation"/> is a struct with a Kind
    /// rather than a class hierarchy — no polymorphic type handling needed.</summary>
    public sealed class SaveItemLocation
    {
        public string Place;
        public int CellX;
        public int CellY;
        public string ContainerId;
        public int SlotIndex;
    }

    public sealed class SaveLedgerEntry
    {
        public int Day;
        public string Kind;
        public string Detail;
        public int Value = -1;
        public bool HasValue;
    }
}
