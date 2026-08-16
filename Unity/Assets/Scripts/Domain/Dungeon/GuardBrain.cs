using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// The escort acts on its own, in the priority order from the design doc:
    ///
    /// 1. deal with an enemy that is about to reach the merchant
    /// 2. attack or shove an adjacent enemy
    /// 3. move into a cell between the merchant and an enemy
    /// 4. otherwise close up on the merchant
    ///
    /// Steps 3 and 4 are one decision here: the goal is always a free cell beside
    /// the merchant, and the tie-break is proximity to the nearest enemy. That
    /// naturally puts the guard in the way without a separate interpose rule.
    ///
    /// No randomness. The player has to be able to predict what the escort will do
    /// before committing their own turn.
    /// </summary>
    public sealed class GuardBrain
    {
        private readonly LootService loot;

        public GuardBrain(LootService loot)
        {
            this.loot = loot;
        }

        public void Act(DungeonRunState run, List<DungeonEvent> events)
        {
            var guard = run.Guard;
            if (guard == null) return;

            var target = ChooseAdjacentTarget(run, guard);
            if (target != null)
            {
                Engage(run, guard, target, events);
                return;
            }

            Reposition(run, guard, events);
        }

        /// <summary>Prefers an enemy that already threatens the merchant over one
        /// that only threatens the guard.</summary>
        private static EnemyActor ChooseAdjacentTarget(DungeonRunState run, GuardActor guard)
        {
            EnemyActor best = null;
            var bestThreatens = false;

            foreach (var enemy in run.Enemies)
            {
                if (GridPos.Distance(enemy.Position, guard.Position) != 1) continue;

                var threatensPlayer = GridPos.Distance(enemy.Position, run.Player.Position) == 1;
                if (best == null || (threatensPlayer && !bestThreatens))
                {
                    best = enemy;
                    bestThreatens = threatensPlayer;
                }
            }

            return best;
        }

        private void Engage(DungeonRunState run, GuardActor guard, EnemyActor enemy, List<DungeonEvent> events)
        {
            // Shoving buys space but deals no damage, so it is only worth doing
            // when the enemy is on the merchant and would survive being hit anyway.
            var threatensPlayer = GridPos.Distance(enemy.Position, run.Player.Position) == 1;
            var wouldSurvive = enemy.Hp > guard.Damage;
            if (threatensPlayer && wouldSurvive && TryShove(run, guard, enemy, events)) return;

            enemy.Hp -= guard.Damage;
            events.Add(DungeonEvent.Attack(guard.Id, enemy.Id, guard.Damage));
            if (!enemy.IsAlive) loot.DefeatEnemy(run, enemy, events);
        }

        private static bool TryShove(DungeonRunState run, GuardActor guard, EnemyActor enemy, List<DungeonEvent> events)
        {
            if (guard.Definition.PushPower < enemy.Definition.PushResistance) return false;

            var direction = enemy.Position - guard.Position;
            var destination = enemy.Position + direction;
            if (!run.CanStep(enemy.Position, destination)) return false;

            var from = enemy.Position;
            enemy.Position = destination;
            enemy.StaggerTurns = enemy.StaggerTurns < 1 ? 1 : enemy.StaggerTurns;
            events.Add(DungeonEvent.Shove(guard.Id, enemy.Id, from, destination));
            return true;
        }

        private static void Reposition(DungeonRunState run, GuardActor guard, List<DungeonEvent> events)
        {
            var goals = FreeCellsBeside(run, run.Player.Position);
            if (goals.Count == 0) return;

            goals.Sort((a, b) => DistanceToNearestEnemy(run, a).CompareTo(DistanceToNearestEnemy(run, b)));

            var blocked = new HashSet<GridPos> { run.Player.Position };
            foreach (var enemy in run.Enemies) blocked.Add(enemy.Position);

            var step = GridPathfinding.NextStep(run.Map, guard.Position, goals, blocked);
            if (!step.HasValue) return;

            var from = guard.Position;
            guard.Position = step.Value;
            events.Add(DungeonEvent.Move(guard.Id, from, step.Value));
        }

        private static List<GridPos> FreeCellsBeside(DungeonRunState run, GridPos centre)
        {
            var cells = new List<GridPos>();
            foreach (var step in GridPos.Orthogonal)
            {
                var candidate = centre + step;
                if (!run.Map.CanTraverse(centre, candidate)) continue;
                if (run.EnemyAt(candidate) != null) continue;
                cells.Add(candidate);
            }
            return cells;
        }

        private static int DistanceToNearestEnemy(DungeonRunState run, GridPos cell)
        {
            var nearest = int.MaxValue;
            foreach (var enemy in run.Enemies)
            {
                var distance = GridPos.Distance(cell, enemy.Position);
                if (distance < nearest) nearest = distance;
            }
            return nearest;
        }
    }
}
