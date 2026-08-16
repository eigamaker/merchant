namespace Merchan.Domain
{
    /// <summary>
    /// Which of the three playable modes is running. The shop is one scene with
    /// two modes because closed-up tidying and open-for-business share the same
    /// room and the same walking protagonist.
    /// </summary>
    public enum GameMode
    {
        HomeShopClosed,
        HomeShopOpen,
        Dungeon
    }

    /// <summary>
    /// Everything a save file has to reproduce, minus the per-run dungeon and
    /// shop state that later phases add.
    /// </summary>
    public sealed class GameState
    {
        public const int SaveVersion = 1;

        public GameState(ItemLedger items, InventoryState inventory)
        {
            Items = items;
            Inventory = inventory;
            Day = 1;
            Gold = 300;
            MaxHp = 12;
            Hp = 12;
            Mode = GameMode.HomeShopClosed;
        }

        public ItemLedger Items { get; }

        public InventoryState Inventory { get; }

        public int Day { get; set; }

        public int Gold { get; set; }

        /// <summary>How exposed the merchant is, not a fighter's health. Reaching
        /// zero triggers a rescue, never a death.</summary>
        public int Hp { get; set; }

        public int MaxHp { get; set; }

        public GameMode Mode { get; set; }

        /// <summary>
        /// One expedition per day, per the confirmed day-boundary rule. Closing
        /// the shop advances the day and clears this; returning from the dungeon
        /// does not.
        /// </summary>
        public bool ExpeditionUsedToday { get; set; }

        /// <summary>The escort under contract for the next expedition, if any. The
        /// fee is already paid and is refunded on cancellation.</summary>
        public string HiredGuardId { get; set; }

        public int HiredGuardFee { get; set; }
    }
}
