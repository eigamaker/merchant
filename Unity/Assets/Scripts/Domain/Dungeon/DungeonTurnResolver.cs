using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Runs one dungeon turn to completion, synchronously.
    ///
    /// The order is fixed: the merchant's command, then whatever their new cell
    /// does to them, then the escort, then the enemies. A command that cannot be
    /// carried out returns without moving anything, which is the rule that keeps
    /// a mistyped key from costing a turn.
    ///
    /// Nothing here knows about animation. The caller gets the whole turn's events
    /// at once and replays them at whatever pace it likes.
    /// </summary>
    public sealed class DungeonTurnResolver
    {
        private readonly PlayerActionResolver playerActions;
        private readonly GuardBrain guardBrain;
        private readonly EnemyBrain enemyBrain;

        public DungeonTurnResolver(PlayerActionResolver playerActions, GuardBrain guardBrain, EnemyBrain enemyBrain)
        {
            this.playerActions = playerActions;
            this.guardBrain = guardBrain;
            this.enemyBrain = enemyBrain;
        }

        public TurnResult Execute(DungeonRunState run, GameState state, DungeonCommand command)
        {
            if (run.Outcome.HasValue) return TurnResult.Refused("この遠征はもう終わっている。");

            var result = playerActions.Execute(run, command);
            if (!result.ConsumedTurn) return result;

            var events = new List<DungeonEvent>(result.Events);

            // A rescue or a return ends the expedition immediately. Letting the
            // enemies act afterwards would hit a merchant who is already out.
            if (run.Outcome.HasValue)
            {
                run.Turn++;
                return TurnResult.Consumed(events);
            }

            if (run.Guard != null) run.Guard.HasInterceptedThisTurn = false;

            guardBrain.Act(run, events);
            enemyBrain.ActAll(run, state, events);

            run.Turn++;
            return TurnResult.Consumed(events);
        }
    }
}
