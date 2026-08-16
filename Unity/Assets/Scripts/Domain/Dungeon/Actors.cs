namespace Merchan.Domain
{
    /// <summary>Anything that occupies a cell. No two actors ever share one, which
    /// is what lets the guard body-block for the protagonist.</summary>
    public abstract class Actor
    {
        protected Actor(string id, GridPos position)
        {
            Id = id;
            Position = position;
        }

        public string Id { get; }

        public GridPos Position { get; internal set; }
    }

    public sealed class PlayerActor : Actor
    {
        public const string ActorId = "player";

        public PlayerActor(GridPos position)
            : base(ActorId, position)
        {
            Facing = Facing.Down;
        }

        /// <summary>Drives the contextual action, so it is a rule, not a sprite
        /// detail. Turning never costs a turn.</summary>
        public Facing Facing { get; internal set; }
    }

    public sealed class GuardActor : Actor
    {
        public GuardActor(GuardDefinition definition, GridPos position, int maxHp, int damage)
            : base(definition.Id, position)
        {
            Definition = definition;
            MaxHp = maxHp;
            Hp = maxHp;
            Damage = damage;
        }

        public GuardDefinition Definition { get; }

        public int Hp { get; internal set; }

        public int MaxHp { get; }

        public int Damage { get; }

        public string Name => Definition.Name;

        /// <summary>Cleared at the start of every turn. The guard may body-block
        /// for the protagonist once per turn, no more.</summary>
        public bool HasInterceptedThisTurn { get; internal set; }
    }

    public enum EnemyState
    {
        Patrol,
        Chase,
        Search
    }

    public sealed class EnemyActor : Actor
    {
        public EnemyActor(string id, EnemyDefinition definition, GridPos position)
            : base(id, position)
        {
            Definition = definition;
            Hp = definition.MaxHp;
            State = EnemyState.Patrol;
        }

        public EnemyDefinition Definition { get; }

        public int Hp { get; internal set; }

        public EnemyState State { get; internal set; }

        /// <summary>The last known position of whoever it is hunting. Kept after
        /// the target slips away, so a smoke bomb leaves the enemy searching the
        /// wrong place rather than snapping straight back on.</summary>
        public GridPos? Target { get; internal set; }

        /// <summary>Turns spent recovering from a shove. A staggered enemy loses
        /// its action, which is the whole point of pushing instead of fighting.</summary>
        public int StaggerTurns { get; internal set; }

        /// <summary>Turns during which the enemy cannot re-acquire a chase, however
        /// close the merchant is. Without this a smoke bomb would be pointless:
        /// the enemy would simply notice again on the very next turn.</summary>
        public int BlindTurns { get; internal set; }

        public string Name => Definition.Name;

        public bool IsAlive => Hp > 0;
    }
}
