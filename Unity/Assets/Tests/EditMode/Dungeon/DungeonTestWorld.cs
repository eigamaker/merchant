using System.Collections.Generic;
using Merchan.Domain;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// An open 5x3 room with one escort and whatever enemies a test places.
    ///
    /// The numbers are chosen so each branch of the rules is reachable:
    /// a slime dies to one dagger swing and can be shoved by the merchant, while
    /// an orc survives the escort's attack and resists the merchant's shove but
    /// not the escort's.
    /// </summary>
    internal sealed class DungeonTestWorld
    {
        public const string Herb = "herb";
        public const string Dagger = "dagger";
        public const string SmokeBomb = "smoke-bomb";
        public const string Salve = "salve";
        public const string ReturnStone = "return-stone";

        private static readonly string[] Room =
        {
            "#######",
            "#.....#",
            "#.....#",
            "#.....#",
            "#######"
        };

        public DungeonTestWorld(int seed = 1234)
        {
            Catalog = new ItemCatalog(new[]
            {
                new ItemDefinition(Herb, ItemCategory.Material, "薬草", "傷薬になる薬草", "銀露草", 50, 1, stackable: true, maxStack: 10),
                new ItemDefinition(Dagger, ItemCategory.Weapon, "欠けた短剣", "盗賊の短剣らしい", "夜鴉団の合図短剣", 190, 1, power: 2),
                new ItemDefinition(SmokeBomb, ItemCategory.Consumable, "煙玉", "煙玉", "夜隠しの煙玉", 120, 1, stackable: true, maxStack: 5, effect: ConsumableEffect.Smoke, effectAmount: 3),
                new ItemDefinition(Salve, ItemCategory.Consumable, "軟膏", "傷薬", "銀露の軟膏", 90, 1, stackable: true, maxStack: 5, effect: ConsumableEffect.Heal, effectAmount: 4),
                new ItemDefinition(ReturnStone, ItemCategory.Consumable, "帰還石", "帰還石", "灰灯の帰還石", 400, 1, stackable: true, maxStack: 3, effect: ConsumableEffect.ReturnHome)
            });

            LootTables = new LootTableCatalog(new[]
            {
                new LootTableDefinition("always-herb", new[] { new LootTableEntry(Herb, 1) }),
                new LootTableDefinition("always-nothing", new[] { LootTableEntry.Nothing(1) })
            });

            Slime = new EnemyDefinition("slime", "スライム", maxHp: 2, damage: 1, chaseRange: 6, pushResistance: 1, lootTableId: "always-herb");
            Orc = new EnemyDefinition("orc", "オーク", maxHp: 8, damage: 3, chaseRange: 6, pushResistance: 3, lootTableId: "always-nothing");
            Rolf = new GuardDefinition("rolf", "ロルフ", "傭兵", baseFee: 60, baseMaxHp: 10, damage: 3, pushPower: 3);

            Ledger = new ItemLedger();
            Inventory = new InventoryState();
            QuickSlots = new QuickSlotService(Ledger, Inventory, Catalog);
            Items = new InventoryService(Ledger, Inventory, Catalog, QuickSlots);
            State = new GameState(Ledger, Inventory) { Mode = GameMode.Dungeon };

            Loot = new LootService(Ledger, LootTables, Items, State);
            PlayerActions = new PlayerActionResolver(State, Ledger, Items, QuickSlots, Catalog, Loot);
            Turns = new DungeonTurnResolver(PlayerActions, new GuardBrain(Loot), new EnemyBrain());

            var map = GridMap.FromRows(Room, new GridPos(1, 1), new GridPos(5, 3));
            Run = new DungeonRunState(map, seed, 1, new PlayerActor(new GridPos(3, 2)));
        }

        public ItemCatalog Catalog { get; }

        public LootTableCatalog LootTables { get; }

        public EnemyDefinition Slime { get; }

        public EnemyDefinition Orc { get; }

        public GuardDefinition Rolf { get; }

        public ItemLedger Ledger { get; }

        public InventoryState Inventory { get; }

        public QuickSlotService QuickSlots { get; }

        public InventoryService Items { get; }

        public GameState State { get; }

        public LootService Loot { get; }

        public PlayerActionResolver PlayerActions { get; }

        public DungeonTurnResolver Turns { get; }

        public DungeonRunState Run { get; }

        public PlayerActor Player => Run.Player;

        public EnemyActor AddEnemy(EnemyDefinition definition, GridPos at, string id = null)
        {
            var enemy = new EnemyActor(id ?? $"{definition.Id}-{Run.Enemies.Count + 1}", definition, at);
            Run.Enemies.Add(enemy);
            return enemy;
        }

        public GuardActor AddGuard(GridPos at)
        {
            Run.AssignGuard(new GuardActor(Rolf, at, Rolf.BaseMaxHp, Rolf.Damage));
            return Run.Guard;
        }

        /// <summary>Puts a weapon in the merchant's hand, which is the only way `F`
        /// does anything.</summary>
        public ItemInstance HoldWeapon()
        {
            var dagger = Ledger.Create(Dagger, 1, 1, ItemLocation.InPlayerBag());
            QuickSlots.TryAssign(0, dagger.Uuid);
            QuickSlots.Select(0);
            return dagger;
        }

        public ItemInstance CarryConsumable(string definitionId, int quantity = 1)
        {
            var item = Ledger.Create(definitionId, 1, 1, ItemLocation.InPlayerBag(), quantity);
            QuickSlots.TrySetQuickConsumable(item.Uuid);
            return item;
        }

        public TurnResult Do(DungeonCommand command) => Turns.Execute(Run, State, command);

        public TurnResult Face(Facing facing) => Do(DungeonCommand.Face(facing.ToStep()));

        public TurnResult Move(Facing facing) => Do(DungeonCommand.Move(facing.ToStep()));

        public IReadOnlyList<ContextAction> Prompts() => PlayerActions.ContextActions(Run);
    }
}
