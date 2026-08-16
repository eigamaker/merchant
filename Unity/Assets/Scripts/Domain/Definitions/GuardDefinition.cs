namespace Merchan.Domain
{
    public enum GuardTrait
    {
        Standard,
        /// <summary>Spots traps near the protagonist. Cheaper, but hits softer.</summary>
        Scout
    }

    /// <summary>
    /// Authored data for an escort. The guard is the party's fighting strength;
    /// every number here is meant to read as clearly stronger than what the
    /// merchant can do alone.
    /// </summary>
    public sealed class GuardDefinition
    {
        public GuardDefinition(
            string id,
            string name,
            string title,
            int baseFee,
            int baseMaxHp,
            int damage,
            int pushPower,
            GuardTrait trait = GuardTrait.Standard,
            string description = "")
        {
            Id = id;
            Name = name;
            Title = title;
            BaseFee = baseFee;
            BaseMaxHp = baseMaxHp;
            Damage = damage;
            PushPower = pushPower;
            Trait = trait;
            Description = description ?? "";
        }

        public string Id { get; }

        public string Name { get; }

        public string Title { get; }

        public int BaseFee { get; }

        public int BaseMaxHp { get; }

        public int Damage { get; }

        /// <summary>Compared against an enemy's push resistance. Deterministic —
        /// the player has to be able to predict whether a shove will land.</summary>
        public int PushPower { get; }

        public GuardTrait Trait { get; }

        public string Description { get; }
    }
}
