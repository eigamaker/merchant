namespace Merchan.Domain
{
    /// <summary>What a defeated enemy leaves behind, for presentation. The rules
    /// treat every remnant the same; only the sprite and the wording differ.</summary>
    public enum RemnantKind
    {
        Humanoid,
        Beast,
        Construct,
        Plant
    }

    public sealed class EnemyDefinition
    {
        public EnemyDefinition(
            string id,
            string name,
            int maxHp,
            int damage,
            int chaseRange,
            int pushResistance,
            string lootTableId,
            RemnantKind remnant = RemnantKind.Beast)
        {
            Id = id;
            Name = name;
            MaxHp = maxHp;
            Damage = damage;
            ChaseRange = chaseRange;
            PushResistance = pushResistance;
            LootTableId = lootTableId;
            Remnant = remnant;
        }

        public string Id { get; }

        public string Name { get; }

        public int MaxHp { get; }

        public int Damage { get; }

        /// <summary>Manhattan distance at which the enemy starts chasing. Beyond
        /// it a chasing enemy drops to searching, which is what makes breaking
        /// line of sight a real alternative to fighting.</summary>
        public int ChaseRange { get; }

        public int PushResistance { get; }

        public string LootTableId { get; }

        public RemnantKind Remnant { get; }
    }
}
