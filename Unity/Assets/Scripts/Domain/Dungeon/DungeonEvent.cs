using System.Collections.Generic;

namespace Merchan.Domain
{
    public enum DungeonEventKind
    {
        Move,
        Attack,
        Intercepted,
        Shove,
        ShoveFailed,
        Staggered,
        Defeated,
        RemnantLeft,
        ContainerSearched,
        ItemTaken,
        TrapSprung,
        Rescued,
        LeftDungeon,
        Message
    }

    /// <summary>
    /// One thing that happened during a turn. The domain resolves a whole turn
    /// synchronously and hands back the list; the scene layer replays it as
    /// animation and locks input until the queue drains. Nothing in here depends
    /// on how long an animation takes, so tests never wait.
    /// </summary>
    public sealed class DungeonEvent
    {
        private DungeonEvent(DungeonEventKind kind)
        {
            Kind = kind;
        }

        public DungeonEventKind Kind { get; private set; }

        public string ActorId { get; private set; }

        public string TargetId { get; private set; }

        public GridPos From { get; private set; }

        public GridPos To { get; private set; }

        public int Amount { get; private set; }

        public string ItemUuid { get; private set; }

        public string Text { get; private set; }

        public static DungeonEvent Move(string actorId, GridPos from, GridPos to) =>
            new DungeonEvent(DungeonEventKind.Move) { ActorId = actorId, From = from, To = to };

        public static DungeonEvent Attack(string attackerId, string targetId, int damage) =>
            new DungeonEvent(DungeonEventKind.Attack) { ActorId = attackerId, TargetId = targetId, Amount = damage };

        /// <summary>The escort stepped in front of a blow meant for the merchant.</summary>
        public static DungeonEvent Intercepted(string guardId, string attackerId, int damage) =>
            new DungeonEvent(DungeonEventKind.Intercepted) { ActorId = guardId, TargetId = attackerId, Amount = damage };

        public static DungeonEvent Shove(string actorId, string targetId, GridPos from, GridPos to) =>
            new DungeonEvent(DungeonEventKind.Shove) { ActorId = actorId, TargetId = targetId, From = from, To = to };

        public static DungeonEvent ShoveFailed(string actorId, string targetId) =>
            new DungeonEvent(DungeonEventKind.ShoveFailed) { ActorId = actorId, TargetId = targetId };

        public static DungeonEvent Staggered(string actorId) =>
            new DungeonEvent(DungeonEventKind.Staggered) { ActorId = actorId };

        public static DungeonEvent Defeated(string actorId) =>
            new DungeonEvent(DungeonEventKind.Defeated) { ActorId = actorId };

        public static DungeonEvent RemnantLeft(string containerId, GridPos at) =>
            new DungeonEvent(DungeonEventKind.RemnantLeft) { TargetId = containerId, To = at };

        public static DungeonEvent ContainerSearched(string containerId, int itemCount) =>
            new DungeonEvent(DungeonEventKind.ContainerSearched) { TargetId = containerId, Amount = itemCount };

        public static DungeonEvent ItemTaken(string itemUuid) =>
            new DungeonEvent(DungeonEventKind.ItemTaken) { ItemUuid = itemUuid };

        public static DungeonEvent TrapSprung(GridPos at, int damage) =>
            new DungeonEvent(DungeonEventKind.TrapSprung) { To = at, Amount = damage };

        public static DungeonEvent Rescued() => new DungeonEvent(DungeonEventKind.Rescued);

        public static DungeonEvent LeftDungeon() => new DungeonEvent(DungeonEventKind.LeftDungeon);

        public static DungeonEvent Message(string text) =>
            new DungeonEvent(DungeonEventKind.Message) { Text = text };

        public override string ToString() => TargetId == null ? $"{Kind}({ActorId})" : $"{Kind}({ActorId}->{TargetId})";
    }

    /// <summary>
    /// The outcome of one player command. <see cref="ConsumedTurn"/> is the whole
    /// contract of the turn model: exactly the actions listed in the design doc
    /// advance the world, and everything else — turning, switching quick slots,
    /// opening the bag, a refused move — leaves it untouched.
    /// </summary>
    public sealed class TurnResult
    {
        private static readonly IReadOnlyList<DungeonEvent> NoEvents = new DungeonEvent[0];

        private TurnResult(bool consumedTurn, IReadOnlyList<DungeonEvent> events)
        {
            ConsumedTurn = consumedTurn;
            Events = events ?? NoEvents;
        }

        public bool ConsumedTurn { get; }

        public IReadOnlyList<DungeonEvent> Events { get; }

        public static TurnResult Consumed(IReadOnlyList<DungeonEvent> events) => new TurnResult(true, events);

        /// <summary>The command could not be carried out. The world must not move,
        /// or the player is punished for pressing a key that did nothing.</summary>
        public static TurnResult Refused(string reason) =>
            new TurnResult(false, new[] { DungeonEvent.Message(reason) });

        public static TurnResult Free(IReadOnlyList<DungeonEvent> events) => new TurnResult(false, events);
    }
}
