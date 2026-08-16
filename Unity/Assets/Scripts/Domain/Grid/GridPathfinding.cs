using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Breadth-first stepping, ported from engine.ts's nextPathStep.
    ///
    /// Neighbours are always visited in <see cref="GridPos.Orthogonal"/> order, so
    /// ties break the same way every run. Every AI decision in the dungeon has to
    /// be reproducible from the run seed alone.
    /// </summary>
    public static class GridPathfinding
    {
        /// <summary>
        /// The first step of a shortest path from <paramref name="start"/> to the
        /// nearest of <paramref name="goals"/>, or null when none is reachable.
        /// Returns null when already standing on a goal.
        /// </summary>
        public static GridPos? NextStep(GridMap map, GridPos start, IReadOnlyCollection<GridPos> goals, ICollection<GridPos> blocked)
        {
            if (goals == null || goals.Count == 0) return null;

            var goalSet = new HashSet<GridPos>(goals);
            if (goalSet.Contains(start)) return null;

            var visited = new HashSet<GridPos> { start };
            var queue = new Queue<Step>();
            queue.Enqueue(new Step(start, null));

            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                foreach (var direction in GridPos.Orthogonal)
                {
                    var next = current.Position + direction;
                    if (visited.Contains(next)) continue;
                    if (!map.CanTraverse(current.Position, next)) continue;
                    if (blocked != null && blocked.Contains(next)) continue;

                    // The first move of this branch, remembered so the caller gets a
                    // single step rather than a whole path it would only re-plan.
                    var first = current.First ?? next;
                    if (goalSet.Contains(next)) return first;

                    visited.Add(next);
                    queue.Enqueue(new Step(next, first));
                }
            }

            return null;
        }

        private readonly struct Step
        {
            public Step(GridPos position, GridPos? first)
            {
                Position = position;
                First = first;
            }

            public GridPos Position { get; }

            public GridPos? First { get; }
        }
    }
}
