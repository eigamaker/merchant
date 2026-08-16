const fs = require("fs");

const src = fs.readFileSync("src/game/content.ts", "utf8");
const block = src.split("const specs:")[1].split("];")[0];
const cat = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const items = [];
for (const line of block.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[")) continue;
  const parts = trimmed.slice(1, trimmed.lastIndexOf("]")).match(/"(?:[^"\\]|\\.)*"|true|false|-?\d+/g);
  if (!parts || parts.length < 8) continue;

  const [id, category, unknown, suspected, trueName, value, bulk, description] = parts;
  const unique = parts[8] === "true";
  const buyer = parts[9] && parts[9].startsWith('"') ? parts[9] : "null";
  const stackable = category === '"material"';
  // The dagger is the merchant's emergency weapon, so it is the one ware that
  // also carries a power value. Everything else is merchandise.
  // Power 1 keeps it at or below every escort's damage, including the scout's.
  // Three swings to kill a slime is meant to feel like a bad plan.
  const power = id === '"notched-dagger"' ? ", power: 1" : "";

  items.push(
    `            New(${id}, ItemCategory.${cat(category.slice(1, -1))}, ${unknown}, ${suspected}, ${trueName}, ` +
      `${value}, ${bulk}, ${description}, ${unique}, ${buyer}` +
      (stackable ? ", stackable: true, maxStack: 10" : "") +
      power +
      `),`
  );
}

const file = `using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// The starting content set, ported from the browser edition's
    /// src/game/content.ts so both implementations describe the same world.
    ///
    /// This lives in the domain assembly because it is data, not presentation: it
    /// has no Unity dependency and the rules tests use exactly what ships. Unity
    /// ScriptableObjects can layer on top later without moving any of it.
    ///
    /// GENERATED IN PART from content.ts. When the browser catalogue changes,
    /// regenerate rather than hand-editing the item table.
    /// </summary>
    public static class StarterContent
    {
        // Supplies the browser edition tracked as bare counters rather than items.
        // The new carry model has no room for a special case, so they are ordinary
        // stackable consumables that occupy the bag like anything else.
        public const string SmokeBomb = "smoke-bomb";
        public const string Salve = "salve";
        public const string ReturnStone = "return-stone";

        public static ItemCatalog Items()
        {
            return new ItemCatalog(new[]
            {
${items.join("\n")}

                New(SmokeBomb, ItemCategory.Consumable, "煙玉", "煙玉", "夜隠しの煙玉", 120, 1, "投げると視界を遮る煙が広がる。", false, "mage", stackable: true, maxStack: 5, effect: ConsumableEffect.Smoke, effectAmount: 3),
                New(Salve, ItemCategory.Consumable, "軟膏", "傷薬", "銀露の軟膏", 90, 1, "銀露草から作った傷薬。", false, "merchant", stackable: true, maxStack: 5, effect: ConsumableEffect.Heal, effectAmount: 4),
                New(ReturnStone, ItemCategory.Consumable, "帰還石", "帰還石", "灰灯の帰還石", 400, 1, "握り砕くと店の前に立っている。", false, "merchant", stackable: true, maxStack: 3, effect: ConsumableEffect.ReturnHome)
            });
        }

        /// <summary>
        /// Escorts. Both hit harder than the merchant's dagger, which is the point:
        /// fighting is the escort's job.
        /// </summary>
        public static IReadOnlyList<GuardDefinition> Guards()
        {
            return new[]
            {
                new GuardDefinition("rolf", "ロルフ", "新人剣士", baseFee: 100, baseMaxHp: 8, damage: 2, pushPower: 2, trait: GuardTrait.Standard,
                    description: "堅実に主人を守る標準型。落とした剣の持ち主。"),
                new GuardDefinition("mina", "ミナ", "斥候", baseFee: 140, baseMaxHp: 6, damage: 1, pushPower: 3, trait: GuardTrait.Scout,
                    description: "周囲3マスの罠を見抜く探索型。押しのけは得意。")
            };
        }

        /// <summary>
        /// Enemies for the first floor. The ids match the imported Craftpix
        /// prefabs under Assets/Prefabs/Enemies/Craftpix so the view layer can
        /// find art without a separate mapping table.
        ///
        /// Push resistance forms a ladder the player can learn: the merchant
        /// (power 1) can only move a slime, an orc or a vampire needs an escort,
        /// and the rooted plant does not move for anyone. That last one is
        /// deliberate — an obstacle you have to go around or cut down is worth
        /// more than one more thing to shove.
        /// </summary>
        public static IReadOnlyList<EnemyDefinition> Enemies()
        {
            return new[]
            {
                new EnemyDefinition("Slime1", "スライム", maxHp: 3, damage: 1, chaseRange: 5, pushResistance: 1, lootTableId: "slime", remnant: RemnantKind.Beast),
                new EnemyDefinition("Plant1", "喰らい花", maxHp: 5, damage: 2, chaseRange: 2, pushResistance: RootedInPlace, lootTableId: "plant", remnant: RemnantKind.Plant),
                new EnemyDefinition("Orc1", "オーク", maxHp: 8, damage: 3, chaseRange: 6, pushResistance: 3, lootTableId: "orc", remnant: RemnantKind.Humanoid),
                new EnemyDefinition("Vampires1", "吸血鬼", maxHp: 12, damage: 4, chaseRange: 8, pushResistance: 3, lootTableId: "vampire", remnant: RemnantKind.Humanoid)
            };
        }

        /// <summary>A resistance no escort can beat. Reserved for things that are
        /// rooted or bolted down.</summary>
        public const int RootedInPlace = 99;

        /// <summary>
        /// The regulars, ported from the browser edition. Between them they cover
        /// every category, so no find is unsellable — but each one only wants two
        /// or three, which is what makes stocking for your customers a decision.
        /// </summary>
        public static IReadOnlyList<CustomerDefinition> Customers()
        {
            return new[]
            {
                new CustomerDefinition("merchant", "ミラ", "町の道具商",
                    new[] { ItemCategory.Material, ItemCategory.Weapon }, budget: 650,
                    knowledge: new[] { ItemCategory.Material }, patienceTicks: 260, ticksPerStep: 4),
                new CustomerDefinition("duke", "ローデン", "剣好きの公爵",
                    new[] { ItemCategory.Weapon, ItemCategory.Art }, budget: 7200,
                    knowledge: new[] { ItemCategory.Weapon }, patienceTicks: 160, ticksPerStep: 5),
                new CustomerDefinition("scholar", "エリス", "古代研究者",
                    new[] { ItemCategory.Relic, ItemCategory.Book }, budget: 3400,
                    knowledge: new[] { ItemCategory.Relic, ItemCategory.Book }, patienceTicks: 320, ticksPerStep: 6),
                new CustomerDefinition("mage", "ネヴァ", "魔法使い",
                    new[] { ItemCategory.Arcane, ItemCategory.Book, ItemCategory.Material }, budget: 5000,
                    knowledge: new[] { ItemCategory.Arcane, ItemCategory.Book }, patienceTicks: 240, ticksPerStep: 4),
                new CustomerDefinition("jeweler", "サフィ", "宝石収集家",
                    new[] { ItemCategory.Gem, ItemCategory.Art }, budget: 4600,
                    knowledge: new[] { ItemCategory.Gem, ItemCategory.Art }, patienceTicks: 200, ticksPerStep: 3)
            };
        }

        /// <summary>
        /// What remnants hold. Every table can come up empty, so searching stays a
        /// decision about spending a turn rather than a formality.
        /// </summary>
        public static LootTableCatalog LootTables()
        {
            return new LootTableCatalog(new[]
            {
                new LootTableDefinition("slime", new[]
                {
                    new LootTableEntry("slime-core", 5),
                    new LootTableEntry("moon-fungus", 2),
                    LootTableEntry.Nothing(4)
                }),
                new LootTableDefinition("plant", new[]
                {
                    new LootTableEntry("herb", 5, 1, 3),
                    new LootTableEntry("silk-thread", 2),
                    LootTableEntry.Nothing(3)
                }),
                new LootTableDefinition("orc", new[]
                {
                    new LootTableEntry("beast-claw", 4),
                    new LootTableEntry("notched-dagger", 2),
                    new LootTableEntry("adventurer-badge", 1),
                    LootTableEntry.Nothing(5)
                }),
                new LootTableDefinition("vampire", new[]
                {
                    new LootTableEntry("old-ring", 1),
                    new LootTableEntry("black-pearl", 2),
                    new LootTableEntry("travel-journal", 3),
                    LootTableEntry.Nothing(4)
                })
            });
        }

        private static ItemDefinition New(
            string id,
            ItemCategory category,
            string unknownName,
            string suspectedName,
            string trueName,
            int baseValue,
            int bulk,
            string description,
            bool unique,
            string preferredBuyer,
            bool stackable = false,
            int maxStack = 1,
            int power = 0,
            ConsumableEffect effect = ConsumableEffect.None,
            int effectAmount = 0)
        {
            return new ItemDefinition(id, category, unknownName, suspectedName, trueName, baseValue, bulk,
                description, unique, preferredBuyer, stackable, maxStack, power, effect, effectAmount);
        }
    }
}
`;

fs.writeFileSync("Unity/Assets/Scripts/Domain/Content/StarterContent.cs", file, "utf8");
console.log(`wrote StarterContent.cs with ${items.length} ported items`);
