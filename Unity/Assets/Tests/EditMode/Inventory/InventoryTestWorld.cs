using Merchan.Domain;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// A small hand-built world for the ownership tests: four definitions that
    /// cover the cases the rules actually branch on — a stacking material, a
    /// stacking consumable, a bulky one-of-a-kind piece and a plain weapon.
    /// </summary>
    internal sealed class InventoryTestWorld
    {
        public const string Herb = "herb";
        public const string SmokeBomb = "smoke-bomb";
        public const string Statue = "statue";
        public const string Sword = "sword";

        public InventoryTestWorld(int slotCapacity = InventoryState.DefaultSlotCapacity, int bulkCapacity = InventoryState.DefaultBulkCapacity)
        {
            Catalog = new ItemCatalog(new[]
            {
                new ItemDefinition(Herb, ItemCategory.Material, "薬草", "傷薬になる薬草", "銀露草", 50, 1, stackable: true, maxStack: 10),
                new ItemDefinition(SmokeBomb, ItemCategory.Consumable, "煙玉", "煙玉", "夜隠しの煙玉", 120, 1, stackable: true, maxStack: 5),
                new ItemDefinition(Statue, ItemCategory.Relic, "小さな石像", "古代祭祀の像", "地下王朝の門番像", 1560, 3, unique: true),
                new ItemDefinition(Sword, ItemCategory.Weapon, "古い剣", "古い騎士剣らしい", "王国軍旧式剣", 260, 2)
            });

            Ledger = new ItemLedger();
            Inventory = new InventoryState(slotCapacity, bulkCapacity);
            QuickSlots = new QuickSlotService(Ledger, Inventory, Catalog);
            Items = new InventoryService(Ledger, Inventory, Catalog, QuickSlots);
        }

        public ItemCatalog Catalog { get; }

        public ItemLedger Ledger { get; }

        public InventoryState Inventory { get; }

        public QuickSlotService QuickSlots { get; }

        public InventoryService Items { get; }

        public ItemInstance Spawn(string definitionId, ItemLocation location, int quantity = 1)
        {
            return Ledger.Create(definitionId, 1, 1, location, quantity);
        }

        public ItemInstance SpawnInBag(string definitionId, int quantity = 1)
        {
            return Spawn(definitionId, ItemLocation.InPlayerBag(), quantity);
        }

        public ItemInstance SpawnOnGround(string definitionId, int x = 0, int y = 0, int quantity = 1)
        {
            return Spawn(definitionId, ItemLocation.OnDungeonGround(new GridPos(x, y)), quantity);
        }
    }
}
