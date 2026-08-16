using System.Collections.Generic;

namespace Merchan.Domain
{
    public sealed class CustomerDefinition
    {
        public CustomerDefinition(
            string id,
            string name,
            string title,
            IReadOnlyList<ItemCategory> interests,
            int budget,
            IReadOnlyList<ItemCategory> knowledge = null,
            int patienceTicks = 220,
            int ticksPerStep = 4)
        {
            Id = id;
            Name = name;
            Title = title;
            Interests = interests;
            Budget = budget;
            Knowledge = knowledge ?? new ItemCategory[0];
            PatienceTicks = patienceTicks;
            TicksPerStep = ticksPerStep;
        }

        public string Id { get; }

        public string Name { get; }

        public string Title { get; }

        public IReadOnlyList<ItemCategory> Interests { get; }

        public int Budget { get; }

        /// <summary>Categories this customer can judge. They pay a little more for
        /// what they understand.</summary>
        public IReadOnlyList<ItemCategory> Knowledge { get; }

        /// <summary>How many ticks they will stand in the queue before giving up and
        /// putting the ware back.</summary>
        public int PatienceTicks { get; }

        public int TicksPerStep { get; }

        public bool IsInterestedIn(ItemCategory category) => Contains(Interests, category);

        public bool Understands(ItemCategory category) => Contains(Knowledge, category);

        private static bool Contains(IReadOnlyList<ItemCategory> list, ItemCategory category)
        {
            for (var i = 0; i < list.Count; i++)
                if (list[i] == category)
                    return true;
            return false;
        }
    }

    public sealed class SaleRecord
    {
        public SaleRecord(string itemUuid, string customerId, int price, int day)
        {
            ItemUuid = itemUuid;
            CustomerId = customerId;
            Price = price;
            Day = day;
        }

        public string ItemUuid { get; }

        public string CustomerId { get; }

        public int Price { get; }

        public int Day { get; }
    }

    /// <summary>
    /// What a ware is worth and whether a given customer will take it.
    ///
    /// The asking price comes from the definition and how much is known about the
    /// piece — an unidentified relic cannot be sold as a known one. Manual pricing
    /// is deliberately left out of the first slice: it multiplies the decisions per
    /// item before there is any evidence the loop is fun.
    /// </summary>
    public sealed class SalesService
    {
        private readonly ItemLedger ledger;
        private readonly IItemCatalog catalog;
        private readonly InventoryService inventory;
        private readonly GameState state;

        public SalesService(ItemLedger ledger, IItemCatalog catalog, InventoryService inventory, GameState state)
        {
            this.ledger = ledger;
            this.catalog = catalog;
            this.inventory = inventory;
            this.state = state;
        }

        public List<SaleRecord> Sales { get; } = new List<SaleRecord>();

        /// <summary>Unknown pieces sell for a fraction of their worth. Getting a
        /// thing identified is how the merchant captures the rest.</summary>
        public static double KnowledgeFactor(KnowledgeLevel knowledge)
        {
            switch (knowledge)
            {
                case KnowledgeLevel.Identified: return 1.0;
                case KnowledgeLevel.Suspected: return 0.75;
                default: return 0.5;
            }
        }

        public int AskingPrice(ItemInstance item)
        {
            if (!catalog.TryGet(item.DefinitionId, out var definition)) return 0;
            var price = definition.BaseValue * KnowledgeFactor(item.Knowledge);
            return price < 1 ? 1 : (int)price;
        }

        /// <summary>
        /// How much this customer wants it, as a multiplier on the asking price.
        /// The base sits below 1 on purpose: a shopper who has no interest in a
        /// category walks past it, which is what makes stocking to your customers
        /// matter.
        /// </summary>
        public double Appeal(ItemInstance item, CustomerDefinition customer)
        {
            if (!catalog.TryGet(item.DefinitionId, out var definition)) return 0;

            var appeal = 0.7;
            if (customer.IsInterestedIn(definition.Category)) appeal += 0.4;
            if (customer.Understands(definition.Category)) appeal += 0.2;
            return appeal;
        }

        public bool WouldBuy(ItemInstance item, CustomerDefinition customer)
        {
            if (item == null || item.Location.Place != ItemPlace.ShelfSlot) return false;
            if (item.IsReserved) return false;

            var price = AskingPrice(item);
            return price > 0 && customer.Budget >= price && Appeal(item, customer) >= 1.0;
        }

        /// <summary>
        /// Completes a purchase. The ware moves to the sold archive rather than
        /// being destroyed, because the shop ledger has to be able to show what was
        /// found where and who ended up with it.
        /// </summary>
        public SaleRecord Sell(ItemInstance item, CustomerDefinition customer)
        {
            var price = AskingPrice(item);
            var result = inventory.TryMove(item.Uuid, ItemLocation.Sold());
            if (!result.Success) return null;

            state.Gold += price;
            item.History.Add(new LedgerEntry(state.Day, LedgerEntryKind.Sold, $"{customer.Name}へ売却", price));

            var record = new SaleRecord(item.Uuid, customer.Id, price, state.Day);
            Sales.Add(record);
            return record;
        }

        /// <summary>
        /// Puts an abandoned ware back. The original slot is preferred; if it has
        /// been refilled the piece goes to storage rather than vanishing.
        /// </summary>
        public void ReturnToStock(ItemInstance item, string shelfId, int slotIndex)
        {
            inventory.ReleaseReservation(item.Uuid);

            var slot = ItemLocation.OnShelf(shelfId, slotIndex);
            if (shelfId != null && ledger.OnShelfSlot(shelfId, slotIndex) == null && inventory.TryMove(item.Uuid, slot).Success) return;

            inventory.TryMove(item.Uuid, ItemLocation.InShopStorage());
        }
    }
}
