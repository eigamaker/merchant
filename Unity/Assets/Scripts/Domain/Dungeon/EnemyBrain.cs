using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Enemy decisions for one turn. Ported from engine.ts's enemyPhase and
    /// moveEnemy, with the escort interception rule added.
    ///
    /// Enemies never enter an occupied cell; they attack from beside it. That is
    /// what makes the escort's body a real obstacle and lets shoving open a route
    /// rather than just trading damage.
    /// </summary>
    public sealed class EnemyBrain
    {
        public void ActAll(DungeonRunState run, GameState state, List<DungeonEvent> events)
        {
            var rng = new Rng(run.TurnSeed);

            // Iterate a copy: resolving one enemy can end the run, and a rescue
            // must stop the rest of the phase rather than keep hitting a merchant
            // who is already being carried home.
            foreach (var enemy in run.Enemies.ToArray())
            {
                if (run.Outcome.HasValue) return;
                if (!enemy.IsAlive) continue;

                if (enemy.StaggerTurns > 0)
                {
                    enemy.StaggerTurns--;
                    events.Add(DungeonEvent.Staggered(enemy.Id));
                    continue;
                }

                if (TryAttack(run, state, enemy, events)) continue;

                Move(run, enemy, rng, events);
            }
        }

        private static bool TryAttack(DungeonRunState run, GameState state, EnemyActor enemy, List<DungeonEvent> events)
        {
            var guard = run.Guard;

            // The merchant is the target whenever they are in reach. Checking them
            // before the escort is what gives body-blocking something to do.
            if (GridPos.Distance(enemy.Position, run.Player.Position) == 1)
            {
                // One interception per turn, and only when the escort is beside the
                // merchant and within parrying reach of the attacker. Anything
                // looser would make an escorted merchant untouchable.
                if (guard != null
                    && !guard.HasInterceptedThisTurn
                    && GridPos.Distance(guard.Position, run.Player.Position) == 1
                    && GridPos.ReachDistance(guard.Position, enemy.Position) <= 1)
                {
                    guard.HasInterceptedThisTurn = true;
                    Wound(run, guard, enemy, enemy.Definition.Damage, events, intercepted: true);
                    return true;
                }

                return WoundPlayer(run, state, enemy, events);
            }

            if (guard != null && GridPos.Distance(enemy.Position, guard.Position) == 1)
            {
                Wound(run, guard, enemy, enemy.Definition.Damage, events, intercepted: false);
                return true;
            }

            return false;
        }

        private static bool WoundPlayer(DungeonRunState run, GameState state, EnemyActor enemy, List<DungeonEvent> events)
        {
            state.Hp -= enemy.Definition.Damage;
            events.Add(DungeonEvent.Attack(enemy.Id, PlayerActor.ActorId, enemy.Definition.Damage));
            if (state.Hp <= 0)
            {
                state.Hp = 0;
                run.Outcome = RunOutcome.Rescued;
                events.Add(DungeonEvent.Rescued());
            }
            return true;
        }

        private static void Wound(DungeonRunState run, GuardActor guard, EnemyActor attacker, int damage, List<DungeonEvent> events, bool intercepted)
        {
            guard.Hp -= damage;
            events.Add(intercepted
                ? DungeonEvent.Intercepted(guard.Id, attacker.Id, damage)
                : DungeonEvent.Attack(attacker.Id, guard.Id, damage));

            if (guard.Hp > 0) return;

            // A downed escort withdraws rather than dying. The merchant is now
            // alone, which is the actual consequence.
            guard.Hp = 0;
            run.Guard = null;
            events.Add(DungeonEvent.Defeated(guard.Id));
        }

        private static void Move(DungeonRunState run, EnemyActor enemy, Rng rng, List<DungeonEvent> events)
        {
            var target = NearestTarget(run, enemy);
            var distance = GridPos.Distance(enemy.Position, target);

            if (enemy.BlindTurns > 0)
            {
                // Smoked. It keeps walking towards the stale target instead of
                // turning around, which is what buys the merchant the escape.
                enemy.BlindTurns--;
            }
            else if (distance <= enemy.Definition.ChaseRange)
            {
                enemy.State = EnemyState.Chase;
                enemy.Target = target;
            }
            else if (enemy.State == EnemyState.Chase)
            {
                // Keeps the stale target, so it heads for where the merchant was.
                enemy.State = EnemyState.Search;
            }

            foreach (var direction in StepOrder(enemy, rng))
            {
                if (direction == default) continue;

                var next = enemy.Position + direction;
                if (!run.CanStep(enemy.Position, next)) continue;

                var from = enemy.Position;
                enemy.Position = next;
                events.Add(DungeonEvent.Move(enemy.Id, from, next));
                return;
            }
        }

        private static GridPos NearestTarget(DungeonRunState run, EnemyActor enemy)
        {
            var target = run.Player.Position;
            if (run.Guard == null) return target;

            return GridPos.Distance(enemy.Position, run.Guard.Position) < GridPos.Distance(enemy.Position, target)
                ? run.Guard.Position
                : target;
        }

        private static IEnumerable<GridPos> StepOrder(EnemyActor enemy, Rng rng)
        {
            if (enemy.State != EnemyState.Patrol && enemy.Target.HasValue)
            {
                var goal = enemy.Target.Value;
                var horizontal = new GridPos(System.Math.Sign(goal.X - enemy.Position.X), 0);
                var vertical = new GridPos(0, System.Math.Sign(goal.Y - enemy.Position.Y));

                // Which axis it tries first is seeded, so an enemy hugging a corner
                // does not lock into the same wall forever, yet still replays
                // identically from the same run seed.
                return rng.Next() > 0.5 ? new[] { horizontal, vertical } : new[] { vertical, horizontal };
            }

            var shuffled = (GridPos[])GridPos.Orthogonal.Clone();
            for (var i = shuffled.Length - 1; i > 0; i--)
            {
                var j = rng.Int(0, i);
                (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
            }
            return shuffled;
        }
    }
}
