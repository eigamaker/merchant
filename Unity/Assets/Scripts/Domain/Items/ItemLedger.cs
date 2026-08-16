using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// The one and only owner of every ItemInstance in the game.
    ///
    /// Containers — the bag, the storage room, a shelf slot, a customer's hands,
    /// the sold archive — are not lists. They are queries over this ledger,
    /// filtered by <see cref="ItemInstance.Location"/>. That is what makes "one
    /// item is never in two places" a structural property instead of something
    /// tests have to keep chasing.
    ///
    /// Items are enumerated in creation order so listings and saves are stable.
    /// </summary>
    public sealed class ItemLedger
    {
        private readonly List<ItemInstance> ordered = new List<ItemInstance>();
        private readonly Dictionary<string, ItemInstance> byUuid = new Dictionary<string, ItemInstance>();

        private int nextSequence = 1;

        /// <summary>Persisted so a reloaded game never reissues a live uuid.</summary>
        public int NextSequence => nextSequence;

        public IReadOnlyList<ItemInstance> All => ordered;

        /// <summary>Mints a new instance. Loot tables roll a count for stacking
        /// materials, so quantity is part of creation rather than something the
        /// caller patches afterwards.</summary>
        public ItemInstance Create(string definitionId, int discoveredDay, int? discoveredFloor, ItemLocation location, int quantity = 1)
        {
            var sequence = nextSequence++;
            var item = new ItemInstance(sequence, $"item-{sequence}", definitionId, discoveredDay, discoveredFloor)
            {
                Location = location,
                Quantity = quantity < 1 ? 1 : quantity
            };
            ordered.Add(item);
            byUuid.Add(item.Uuid, item);
            return item;
        }

        /// <summary>
        /// Rebuilds an instance from a save file, keeping its original uuid and
        /// creation order. The next minted sequence is pushed past anything
        /// restored so a reloaded game never reissues a live uuid.
        /// </summary>
        public ItemInstance Restore(
            int sequence,
            string uuid,
            string definitionId,
            int discoveredDay,
            int? discoveredFloor,
            int quantity,
            KnowledgeLevel knowledge,
            ItemLocation location,
            string reservedBy)
        {
            var item = new ItemInstance(sequence, uuid, definitionId, discoveredDay, discoveredFloor)
            {
                Quantity = quantity < 1 ? 1 : quantity,
                Knowledge = knowledge,
                Location = location,
                ReservedBy = string.IsNullOrEmpty(reservedBy) ? null : reservedBy
            };

            ordered.Add(item);
            byUuid.Add(item.Uuid, item);
            if (sequence >= nextSequence) nextSequence = sequence + 1;
            return item;
        }

        public bool TryGet(string uuid, out ItemInstance item)
        {
            if (uuid == null)
            {
                item = null;
                return false;
            }
            return byUuid.TryGetValue(uuid, out item);
        }

        public ItemInstance Get(string uuid)
        {
            TryGet(uuid, out var item);
            return item;
        }

        public bool Contains(string uuid) => uuid != null && byUuid.ContainsKey(uuid);

        public IEnumerable<ItemInstance> At(ItemPlace place)
        {
            foreach (var item in ordered)
                if (item.Location.Place == place)
                    yield return item;
        }

        public IEnumerable<ItemInstance> InBag() => At(ItemPlace.PlayerBag);

        public IEnumerable<ItemInstance> InShopStorage() => At(ItemPlace.ShopStorage);

        public IEnumerable<ItemInstance> OnShelf(string shelfId)
        {
            foreach (var item in ordered)
                if (item.Location.Place == ItemPlace.ShelfSlot && item.Location.ContainerId == shelfId)
                    yield return item;
        }

        public ItemInstance OnShelfSlot(string shelfId, int slotIndex)
        {
            foreach (var item in ordered)
                if (item.Location == ItemLocation.OnShelf(shelfId, slotIndex))
                    return item;
            return null;
        }

        public IEnumerable<ItemInstance> OnGroundAt(GridPos cell)
        {
            foreach (var item in ordered)
                if (item.Location == ItemLocation.OnDungeonGround(cell))
                    yield return item;
        }

        public IEnumerable<ItemInstance> HeldBy(string customerId)
        {
            foreach (var item in ordered)
                if (item.Location == ItemLocation.HeldByCustomer(customerId))
                    yield return item;
        }

        internal void SetLocation(ItemInstance item, ItemLocation location)
        {
            item.Location = location;
        }

        /// <summary>
        /// Records what examining or appraising revealed. Knowledge never
        /// regresses, and the change is written to the item's history because the
        /// shop ledger shows how the protagonist came to know a piece.
        ///
        /// This also changes the item's stack key, so a newly identified stack
        /// stops merging with the unidentified ones beside it. That is intended.
        /// </summary>
        public void SetKnowledge(ItemInstance item, KnowledgeLevel knowledge, int day, string detail)
        {
            if (item == null || item.Knowledge >= knowledge) return;

            item.Knowledge = knowledge;
            item.History.Add(new LedgerEntry(day, LedgerEntryKind.Examined, detail));
        }

        /// <summary>Drops an instance that no longer exists — one that merged into
        /// another stack, or was consumed outright. Callers must clear any
        /// reference to its uuid first; <see cref="InventoryService"/> does.</summary>
        internal void Forget(ItemInstance item)
        {
            ordered.Remove(item);
            byUuid.Remove(item.Uuid);
        }
    }
}
