namespace Merchan.Domain
{
    public enum DungeonCommandKind
    {
        /// <summary>Turn to face a direction. Never costs a turn — the whole point
        /// of a separate command is that aiming the contextual action is free.</summary>
        Face,
        Move,
        Wait,
        /// <summary>`R`. Shoves whatever stands in front.</summary>
        Shove,
        /// <summary>`F`. Uses the held quick-slot item on the cell in front.</summary>
        UseHeld,
        /// <summary>`C`. Uses the item bound to the consumable slot.</summary>
        UseQuickConsumable,
        /// <summary>`E`. Resolves against the cell in front, then the cell underfoot.</summary>
        Context
    }

    public readonly struct DungeonCommand
    {
        private DungeonCommand(DungeonCommandKind kind, GridPos direction, string targetId, string itemUuid)
        {
            Kind = kind;
            Direction = direction;
            TargetId = targetId;
            ItemUuid = itemUuid;
        }

        public DungeonCommandKind Kind { get; }

        public GridPos Direction { get; }

        /// <summary>Set when the player picked from the disambiguation list rather
        /// than taking the highest-priority candidate.</summary>
        public string TargetId { get; }

        public string ItemUuid { get; }

        public static DungeonCommand Face(GridPos direction) => new DungeonCommand(DungeonCommandKind.Face, direction, null, null);

        public static DungeonCommand Move(GridPos direction) => new DungeonCommand(DungeonCommandKind.Move, direction, null, null);

        public static DungeonCommand Wait() => new DungeonCommand(DungeonCommandKind.Wait, default, null, null);

        public static DungeonCommand Shove() => new DungeonCommand(DungeonCommandKind.Shove, default, null, null);

        public static DungeonCommand UseHeld() => new DungeonCommand(DungeonCommandKind.UseHeld, default, null, null);

        public static DungeonCommand UseQuickConsumable() => new DungeonCommand(DungeonCommandKind.UseQuickConsumable, default, null, null);

        public static DungeonCommand Context(string targetId = null, string itemUuid = null) =>
            new DungeonCommand(DungeonCommandKind.Context, default, targetId, itemUuid);
    }

    public enum ContextActionKind
    {
        SearchRemnant,
        OpenChest,
        TakeFromContainer,
        PickUpGround,
        Descend,
        LeaveDungeon
    }

    /// <summary>
    /// One thing `E` could do right now. The resolver returns these in priority
    /// order; the field prompt shows the first, and the disambiguation list only
    /// appears when a single cell offers more than one.
    /// </summary>
    public sealed class ContextAction
    {
        public ContextAction(ContextActionKind kind, GridPos cell, string label, string targetId = null, string itemUuid = null)
        {
            Kind = kind;
            Cell = cell;
            Label = label;
            TargetId = targetId;
            ItemUuid = itemUuid;
        }

        public ContextActionKind Kind { get; }

        public GridPos Cell { get; }

        /// <summary>Shown next to the key in the field prompt, e.g. "遺体を探る".</summary>
        public string Label { get; }

        public string TargetId { get; }

        public string ItemUuid { get; }
    }
}
