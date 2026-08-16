namespace Merchan.Domain
{
    public enum ContainerKind
    {
        /// <summary>What a defeated enemy leaves. Searching it costs a turn.</summary>
        Remnant,
        /// <summary>An authored chest or urn. These are the only things that may
        /// spill straight onto the floor, because they are not bodies.</summary>
        Chest
    }

    /// <summary>
    /// Something in the dungeon that holds items until it is searched.
    ///
    /// Defeating an enemy makes exactly one of these rather than dropping loot on
    /// the ground: with both mechanisms in play the player would be told the same
    /// thing twice, and searching would stop being a decision.
    /// </summary>
    public sealed class DungeonContainer
    {
        public DungeonContainer(string id, ContainerKind kind, string name, GridPos position, RemnantKind remnant = RemnantKind.Beast)
        {
            Id = id;
            Kind = kind;
            Name = name;
            Position = position;
            Remnant = remnant;
        }

        public string Id { get; }

        public ContainerKind Kind { get; }

        public string Name { get; }

        public GridPos Position { get; }

        public RemnantKind Remnant { get; }

        /// <summary>Set once the protagonist has spent a turn looking. An emptied
        /// container stays on the map so the player can see where they have been.</summary>
        public bool Searched { get; internal set; }
    }
}
