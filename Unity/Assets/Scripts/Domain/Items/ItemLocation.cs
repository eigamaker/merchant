using System;

namespace Merchan.Domain
{
    public enum ItemPlace
    {
        /// <summary>Not yet placed anywhere. Only valid before registration.</summary>
        Nowhere,
        DungeonGround,
        /// <summary>Inside a corpse or a chest, until it is searched out.</summary>
        DungeonContainer,
        PlayerBag,
        ShopStorage,
        ShelfSlot,
        CustomerHeld,
        SoldArchive,
        QuestReturned
    }

    /// <summary>
    /// Where an item currently is. This is one field on one instance, which is
    /// how "an ItemInstance exists in exactly one place" is guaranteed:
    /// containers hold uuids and are derived by querying the ledger, so there is
    /// no second list that could disagree.
    ///
    /// Kept as a struct with an explicit Kind rather than a class hierarchy so
    /// it round-trips through the save file as a flat object.
    /// </summary>
    public readonly struct ItemLocation : IEquatable<ItemLocation>
    {
        private ItemLocation(ItemPlace place, GridPos cell, string containerId, int slotIndex)
        {
            Place = place;
            Cell = cell;
            ContainerId = containerId;
            SlotIndex = slotIndex;
        }

        public ItemPlace Place { get; }

        /// <summary>Set for <see cref="ItemPlace.DungeonGround"/>.</summary>
        public GridPos Cell { get; }

        /// <summary>Shelf id for <see cref="ItemPlace.ShelfSlot"/>, customer id
        /// for <see cref="ItemPlace.CustomerHeld"/>.</summary>
        public string ContainerId { get; }

        /// <summary>Slot on the shelf. Unused elsewhere.</summary>
        public int SlotIndex { get; }

        public static ItemLocation Nowhere => new ItemLocation(ItemPlace.Nowhere, default, null, 0);

        public static ItemLocation OnDungeonGround(GridPos cell) => new ItemLocation(ItemPlace.DungeonGround, cell, null, 0);

        public static ItemLocation InDungeonContainer(string containerId) => new ItemLocation(ItemPlace.DungeonContainer, default, containerId, 0);

        public static ItemLocation InPlayerBag() => new ItemLocation(ItemPlace.PlayerBag, default, null, 0);

        public static ItemLocation InShopStorage() => new ItemLocation(ItemPlace.ShopStorage, default, null, 0);

        public static ItemLocation OnShelf(string shelfId, int slotIndex) => new ItemLocation(ItemPlace.ShelfSlot, default, shelfId, slotIndex);

        public static ItemLocation HeldByCustomer(string customerId) => new ItemLocation(ItemPlace.CustomerHeld, default, customerId, 0);

        public static ItemLocation Sold() => new ItemLocation(ItemPlace.SoldArchive, default, null, 0);

        public static ItemLocation ReturnedToQuestGiver() => new ItemLocation(ItemPlace.QuestReturned, default, null, 0);

        /// <summary>True once the item has left play for good. Archived items keep
        /// their history for the ledger UI but never move again.</summary>
        public bool IsArchived => Place == ItemPlace.SoldArchive || Place == ItemPlace.QuestReturned;

        public bool Equals(ItemLocation other)
        {
            return Place == other.Place
                && Cell == other.Cell
                && SlotIndex == other.SlotIndex
                && string.Equals(ContainerId, other.ContainerId, StringComparison.Ordinal);
        }

        public override bool Equals(object obj) => obj is ItemLocation other && Equals(other);

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = (int)Place;
                hash = (hash * 397) ^ Cell.GetHashCode();
                hash = (hash * 397) ^ SlotIndex;
                hash = (hash * 397) ^ (ContainerId?.GetHashCode() ?? 0);
                return hash;
            }
        }

        public static bool operator ==(ItemLocation a, ItemLocation b) => a.Equals(b);

        public static bool operator !=(ItemLocation a, ItemLocation b) => !a.Equals(b);

        public override string ToString()
        {
            switch (Place)
            {
                case ItemPlace.DungeonGround: return $"DungeonGround{Cell}";
                case ItemPlace.DungeonContainer: return $"DungeonContainer({ContainerId})";
                case ItemPlace.ShelfSlot: return $"ShelfSlot({ContainerId}#{SlotIndex})";
                case ItemPlace.CustomerHeld: return $"CustomerHeld({ContainerId})";
                default: return Place.ToString();
            }
        }
    }
}
