using System.Collections.Generic;

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
            New("rusted-sword", ItemCategory.Weapon, "古い剣", "古い騎士剣らしい", "王国軍旧式剣", 260, 2, "刃に消えない血痕がある。", false, "duke"),
            New("black-sword", ItemCategory.Weapon, "黒い長剣", "由来不明の黒剣", "黒騎士アルベルトの呪剣", 3200, 3, "光をほとんど反射しない、冷たい長剣。", true, "duke"),
            New("silver-wolf", ItemCategory.Weapon, "銀の剣", "狼紋の剣", "銀狼騎士団の儀礼剣", 1800, 2, "柄頭に銀狼の紋章がある。", true, "duke"),
            New("bronze-spear", ItemCategory.Weapon, "青銅の槍", "古い儀礼槍", "峡谷王朝の祭礼槍", 620, 3, "穂先に青い錆が浮く。", false, "duke"),
            New("notched-dagger", ItemCategory.Weapon, "欠けた短剣", "盗賊の短剣らしい", "夜鴉団の合図短剣", 190, 1, "柄に羽根の刻印がある。", false, "duke", power: 1),
            New("amber-wand", ItemCategory.Arcane, "琥珀の杖", "魔力を帯びた杖", "雷鳴術師の導杖", 1450, 2, "杖の中で小さな火花が揺れる。", true, "mage"),
            New("cracked-orb", ItemCategory.Arcane, "ひび割れた珠", "魔力を帯びた珠", "月読の観測珠", 900, 1, "中に霧のような光がある。", false, "mage"),
            New("smoke-vial", ItemCategory.Arcane, "曇った小瓶", "煙術の触媒", "夜隠しの錬金触媒", 380, 1, "振ると黒い煙が底を這う。", false, "mage"),
            New("rune-key", ItemCategory.Arcane, "刻印鍵", "封印を解く鍵らしい", "深層門のルーン鍵", 1100, 1, "鍵歯が文字のように並ぶ。", false, "mage"),
            New("moon-charm", ItemCategory.Arcane, "月の護符", "月魔術の護符", "眠り守りの月環", 720, 1, "持つと少しだけ温かい。", false, "mage"),
            New("old-ring", ItemCategory.Relic, "古びた指輪", "北方の貴族指輪らしい", "冬塔家の誓約環", 1250, 1, "内側に読めない文字がある。", true, "scholar"),
            New("stone-statue", ItemCategory.Relic, "小さな石像", "古代祭祀の像", "地下王朝の門番像", 1560, 3, "片目だけが赤い石でできている。", true, "scholar"),
            New("broken-tablet", ItemCategory.Relic, "割れた石板", "古代文字の石板", "エストラ王朝の税記録", 800, 3, "半分だけ文字が残っている。", false, "scholar"),
            New("sun-idol", ItemCategory.Relic, "金色の像", "太陽信仰の像", "暁神殿の祈祷像", 2300, 2, "底に灰がこびりつく。", false, "scholar"),
            New("sealed-box", ItemCategory.Relic, "封じられた箱", "古代の保管箱", "王墓の副葬箱", 1900, 3, "どの鍵穴にも合わない。", false, "scholar"),
            New("tiger-eye", ItemCategory.Gem, "縞模様の石", "虎目石らしい", "夕陽の虎眼石", 460, 1, "光の角度で金色に揺れる。", false, "jeweler"),
            New("blue-gem", ItemCategory.Gem, "青い宝石", "海色のサファイア", "深海王の涙", 2100, 1, "内部に泡のような傷がある。", true, "jeweler"),
            New("rough-opal", ItemCategory.Gem, "乳白色の石", "粗いオパール", "夢見の遊色石", 980, 1, "見る人ごとに色が変わる。", false, "jeweler"),
            New("black-pearl", ItemCategory.Gem, "黒い真珠", "希少な黒真珠", "嵐海の黒珠", 1350, 1, "わずかに潮の香りがする。", false, "jeweler"),
            New("red-crystal", ItemCategory.Gem, "赤い結晶", "炎の結晶", "火竜脈の紅晶", 780, 1, "握ると掌が熱くなる。", false, "jeweler"),
            New("torn-grimoire", ItemCategory.Book, "破れた本", "失われた魔導書の一頁", "星巡りの魔導書・第一頁", 1700, 1, "余白に星図が描かれている。", true, "mage"),
            New("travel-journal", ItemCategory.Book, "古い日誌", "冒険者の日誌", "第一遠征隊の踏査記録", 530, 1, "最後の頁だけ濡れている。", false, "scholar"),
            New("poetry-scroll", ItemCategory.Book, "巻物", "宮廷詩集らしい", "灰冠王の恋歌集", 690, 1, "読めないほど細い字で書かれている。", false, "scholar"),
            New("codex-leaf", ItemCategory.Book, "奇妙な紙片", "古代語の紙片", "深層地図の断片", 1000, 1, "端に階段の印がある。", false, "scholar"),
            New("mosaic-panel", ItemCategory.Art, "色ガラス片", "宗教画の断片", "沈没礼拝堂のモザイク", 860, 2, "青いガラスに人物の目が描かれる。", false, "jeweler"),
            New("masked-portrait", ItemCategory.Art, "小さな肖像画", "貴族の肖像らしい", "仮面侯の肖像", 1480, 2, "見るたびに表情が違って見える。", true, "duke"),
            New("ivory-carving", ItemCategory.Art, "象牙の彫刻", "古い装飾彫刻", "月桂宮の鳥籠飾り", 740, 1, "鳥の瞳に黒い宝石がある。", false, "jeweler"),
            New("bronze-mask", ItemCategory.Art, "青銅の仮面", "古い葬送面", "砂漠王の葬送面", 1650, 2, "裏面に乾いた花が貼られている。", false, "scholar"),
            New("amber-frame", ItemCategory.Art, "琥珀の額縁", "虫入りの琥珀額", "眠らぬ蛾の琥珀標本", 930, 1, "中の蛾がわずかに羽ばたく。", false, "jeweler"),
            New("slime-core", ItemCategory.Material, "透明な塊", "魔物の核", "深青スライムの魔核", 200, 1, "光にかざすと脈打つ。", false, "mage", stackable: true, maxStack: 10),
            New("moon-fungus", ItemCategory.Material, "白い茸", "月光茸", "夜照らし茸", 170, 1, "暗所で淡く光る。", false, "merchant", stackable: true, maxStack: 10),
            New("beast-claw", ItemCategory.Material, "大きな爪", "洞窟獣の爪", "岩穿ち獣の爪", 260, 1, "石の粉が付着している。", false, "merchant", stackable: true, maxStack: 10),
            New("silk-thread", ItemCategory.Material, "銀の糸", "魔蛛の糸", "月糸蜘蛛の吐糸", 430, 1, "切れずに冷たい。", false, "mage", stackable: true, maxStack: 10),
            New("ember-scale", ItemCategory.Material, "赤い鱗", "火蜥蜴の鱗", "溶岩蜥蜴の逆鱗", 620, 1, "角度で炎の色が走る。", false, "mage", stackable: true, maxStack: 10),
            New("herb", ItemCategory.Material, "薬草", "傷薬になる薬草", "銀露草", 50, 1, "葉先に銀色の露が残る。", false, "merchant", stackable: true, maxStack: 10),
            New("adventurer-badge", ItemCategory.Relic, "古い徽章", "冒険者の認識票", "第二遠征隊の隊章", 310, 1, "裏に名前が刻まれている。", false, "merchant"),
            New("bone-flute", ItemCategory.Art, "骨の笛", "儀礼用の笛", "峡谷民の送魂笛", 510, 1, "吹くと音が吸い込まれる。", false, "scholar"),
            New("coral-crown", ItemCategory.Gem, "珊瑚の冠", "海民の冠飾り", "潮王女の珊瑚冠", 1750, 2, "塩をふくと淡く歌う。", false, "jeweler"),
            New("brass-compass", ItemCategory.Relic, "真鍮の方位器", "古い方位器", "迷宮測量士の羅針盤", 1060, 1, "針が北を指さない。", false, "scholar"),
            New("glass-feather", ItemCategory.Arcane, "ガラスの羽", "風術の触媒", "風渡り鳥の結晶羽", 810, 1, "空中でゆっくり回転する。", false, "mage"),

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
