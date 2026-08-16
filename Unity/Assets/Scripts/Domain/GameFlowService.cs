using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Moves the game between the shop and the dungeon, and decides when a day is
    /// over.
    ///
    /// Closing the shop ends the day, not returning from the dungeon. That keeps
    /// the cycle readable — one expedition, one shift behind the counter, one day
    /// — and means coming home wounded does not silently skip the trading that
    /// pays for the next trip.
    /// </summary>
    public sealed class GameFlowService
    {
        private readonly GameState state;
        private readonly ItemLedger ledger;
        private readonly InventoryService inventory;
        private readonly IItemCatalog catalog;

        public GameFlowService(GameState state, ItemLedger ledger, InventoryService inventory, IItemCatalog catalog)
        {
            this.state = state;
            this.ledger = ledger;
            this.inventory = inventory;
            this.catalog = catalog;
        }

        public bool CanDepart => !state.ExpeditionUsedToday && state.Mode == GameMode.HomeShopClosed;

        /// <summary>Sets out. One expedition a day, so this is also what spends the
        /// day's trip.</summary>
        public bool TryDepart()
        {
            if (!CanDepart) return false;

            state.ExpeditionUsedToday = true;
            state.Mode = GameMode.Dungeon;
            return true;
        }

        /// <summary>
        /// Comes home. A rescue costs a share of the haul and a cut of the purse,
        /// and — per the confirmed rule — the rest of the day: there is no opening
        /// up after being carried back.
        /// </summary>
        public IReadOnlyList<ItemInstance> Return(RunOutcome outcome)
        {
            state.Mode = GameMode.HomeShopClosed;

            var lost = outcome == RunOutcome.Rescued ? LoseHalfTheHaul() : new List<ItemInstance>();
            if (outcome == RunOutcome.Rescued)
            {
                state.Gold -= state.Gold / 10;
                EndDay();
            }

            return lost;
        }

        /// <summary>
        /// Half the ordinary finds, cheapest first so the memorable pieces are the
        /// ones that survive. One-of-a-kind items are never lost: watching a
        /// unique relic evaporate to a dice roll reads as the game cheating.
        /// </summary>
        private List<ItemInstance> LoseHalfTheHaul()
        {
            var recoverable = new List<ItemInstance>();
            foreach (var item in ledger.InBag())
            {
                if (!catalog.TryGet(item.DefinitionId, out var definition)) continue;
                if (definition.Unique) continue;
                if (definition.Category == ItemCategory.Consumable) continue;
                recoverable.Add(item);
            }

            recoverable.Sort((a, b) => Value(a).CompareTo(Value(b)));

            var lost = new List<ItemInstance>();
            var toLose = recoverable.Count / 2;
            for (var i = 0; i < toLose; i++)
            {
                lost.Add(recoverable[i]);
                inventory.Destroy(recoverable[i].Uuid);
            }
            return lost;
        }

        private int Value(ItemInstance item)
        {
            return catalog.TryGet(item.DefinitionId, out var definition) ? definition.BaseValue : 0;
        }

        /// <summary>
        /// Ends the trading day. Exposure comes back overnight and tomorrow's
        /// expedition is available again.
        /// </summary>
        public void EndDay()
        {
            state.Day++;
            state.ExpeditionUsedToday = false;
            state.Hp = state.MaxHp;
            state.Mode = GameMode.HomeShopClosed;
        }

        /// <summary>
        /// Called once the last shopper is out. Shutting the door is the only thing
        /// that advances the calendar, so a day spent entirely underground stays
        /// the same day until the merchant opens and closes up.
        /// </summary>
        public bool TryFinishTradingDay(ShopState shop)
        {
            if (shop.Phase != ShopPhase.Closed || shop.VisitsToday == 0) return false;

            EndDay();
            shop.ResetDay();
            return true;
        }
    }
}
