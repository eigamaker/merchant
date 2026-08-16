namespace Merchan.Domain
{
    public enum ItemCategory
    {
        Weapon,
        Arcane,
        Relic,
        Gem,
        Book,
        Art,
        Material,
        Consumable,
        Tool
    }

    /// <summary>How much the protagonist has learned about an item. The name the
    /// player sees, and what a customer will pay, both follow from this.</summary>
    public enum KnowledgeLevel
    {
        Unknown,
        Suspected,
        Identified
    }

    public enum ConsumableEffect
    {
        None,
        /// <summary>Restores exposure. The merchant's only self-repair.</summary>
        Heal,
        /// <summary>Breaks pursuit: every chasing enemy drops to searching and keeps
        /// hunting the cell the merchant was last seen in.</summary>
        Smoke,
        /// <summary>Ends the expedition on the spot and returns to the shop.</summary>
        ReturnHome
    }

    /// <summary>
    /// Authored, read-only data for a kind of item. Unity supplies these from
    /// ScriptableObjects; the domain never mutates them, so a single instance is
    /// shared by every ItemInstance of that kind.
    /// </summary>
    public sealed class ItemDefinition
    {
        public ItemDefinition(
            string id,
            ItemCategory category,
            string unknownName,
            string suspectedName,
            string trueName,
            int baseValue,
            int bulk,
            string description = "",
            bool unique = false,
            string preferredBuyer = null,
            bool stackable = false,
            int maxStack = 1,
            int power = 0,
            ConsumableEffect effect = ConsumableEffect.None,
            int effectAmount = 0)
        {
            Power = power;
            Effect = effect;
            EffectAmount = effectAmount;
            Id = id;
            Category = category;
            UnknownName = unknownName;
            SuspectedName = suspectedName;
            TrueName = trueName;
            BaseValue = baseValue;
            Bulk = bulk < 1 ? 1 : bulk;
            Description = description ?? "";
            Unique = unique;
            PreferredBuyer = preferredBuyer;
            Stackable = stackable;
            MaxStack = stackable ? (maxStack < 1 ? 1 : maxStack) : 1;
        }

        public string Id { get; }

        public ItemCategory Category { get; }

        public string UnknownName { get; }

        public string SuspectedName { get; }

        public string TrueName { get; }

        public int BaseValue { get; }

        /// <summary>1 to 3. Large finds crowd the bag, which is what forces the
        /// "what do I carry home" decision.</summary>
        public int Bulk { get; }

        public string Description { get; }

        /// <summary>A one-of-a-kind piece. Unique items are never stackable and
        /// are protected from the rescue loss roll.</summary>
        public bool Unique { get; }

        public string PreferredBuyer { get; }

        /// <summary>Only materials and consumables stack. Wares and equipment
        /// carry provenance and condition, so two of them are never the same
        /// thing even when they share a definition.</summary>
        public bool Stackable { get; }

        public int MaxStack { get; }

        /// <summary>Damage when held and swung. Deliberately below any escort's:
        /// the merchant may fight in an emergency, never as the plan.</summary>
        public int Power { get; }

        public ConsumableEffect Effect { get; }

        public int EffectAmount { get; }

        public bool IsWeapon => Power > 0;

        public string NameFor(KnowledgeLevel knowledge)
        {
            switch (knowledge)
            {
                case KnowledgeLevel.Identified: return TrueName;
                case KnowledgeLevel.Suspected: return SuspectedName;
                default: return UnknownName;
            }
        }
    }
}
