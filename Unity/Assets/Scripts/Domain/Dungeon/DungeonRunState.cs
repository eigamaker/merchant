using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// One expedition in progress. Ground items and container contents are not
    /// held here — they live in the <see cref="ItemLedger"/> with a dungeon
    /// location, so an item cannot be both on the floor and in the bag.
    /// </summary>
    public sealed class DungeonRunState
    {
        public DungeonRunState(GridMap map, int seed, int floor, PlayerActor player)
        {
            Map = map;
            Seed = seed;
            Floor = floor;
            Player = player;
            Enemies = new List<EnemyActor>();
            Containers = new List<DungeonContainer>();
            Traps = new List<GridPos>();
        }

        public GridMap Map { get; }

        public int Seed { get; }

        public int Floor { get; }

        public int Turn { get; internal set; }

        public PlayerActor Player { get; }

        /// <summary>Null when unescorted, or once the escort has been carried out
        /// wounded. The initial version supports one escort at a time.</summary>
        public GuardActor Guard { get; internal set; }

        public List<EnemyActor> Enemies { get; }

        public List<DungeonContainer> Containers { get; }

        public List<GridPos> Traps { get; }

        /// <summary>Set when the run ends — by the stairs, a return stone, or a
        /// rescue. The scene layer reads it to leave the dungeon.</summary>
        public RunOutcome? Outcome { get; internal set; }

        /// <summary>
        /// The turn on which the merchant may shove again. Stored as an absolute
        /// turn rather than a countdown so it needs no per-turn bookkeeping and
        /// survives a save unchanged.
        /// </summary>
        public int ShoveReadyOnTurn { get; internal set; }

        public bool CanShove => Turn >= ShoveReadyOnTurn;

        /// <summary>The seed for a given turn's enemy decisions. Deriving it from
        /// the run seed and the turn number keeps a replayed run identical, and
        /// matches how the browser edition seeds its enemy phase.</summary>
        public int TurnSeed => Seed + Turn * 37 + Floor;

        /// <summary>Sets where the merchant stands. Used when the run starts and
        /// when a floor change rebuilds the map — not by the turn rules, which move
        /// actors a step at a time.</summary>
        public void PlacePlayer(GridPos cell)
        {
            Player.Position = cell;
        }

        /// <summary>Attaches the hired escort. Passing null leaves the merchant
        /// unescorted, which is also how a wounded escort withdraws.</summary>
        public void AssignGuard(GuardActor guard)
        {
            Guard = guard;
        }

        public EnemyActor EnemyAt(GridPos cell)
        {
            foreach (var enemy in Enemies)
                if (enemy.Position == cell)
                    return enemy;
            return null;
        }

        public DungeonContainer ContainerAt(GridPos cell)
        {
            foreach (var container in Containers)
                if (container.Position == cell)
                    return container;
            return null;
        }

        public DungeonContainer ContainerById(string id)
        {
            foreach (var container in Containers)
                if (container.Id == id)
                    return container;
            return null;
        }

        public bool HasTrapAt(GridPos cell) => Traps.Contains(cell);

        /// <summary>True when any actor stands here. Actors never overlap, so this
        /// is the single occupancy test used by movement, shoving and AI.</summary>
        public bool IsOccupied(GridPos cell)
        {
            if (Player.Position == cell) return true;
            if (Guard != null && Guard.Position == cell) return true;
            return EnemyAt(cell) != null;
        }

        /// <summary>Whether an actor may step from one cell to the next: the map
        /// must allow the crossing and the destination must be free.</summary>
        public bool CanStep(GridPos from, GridPos to)
        {
            return Map.CanTraverse(from, to) && !IsOccupied(to);
        }
    }

    public enum RunOutcome
    {
        /// <summary>Walked out through the entrance or used a return stone.</summary>
        Returned,
        /// <summary>Hit points reached zero. The merchant is carried home, not killed.</summary>
        Rescued
    }
}
