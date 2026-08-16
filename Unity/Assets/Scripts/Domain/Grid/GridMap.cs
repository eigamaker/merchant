using System;
using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// A floor's walkability. Visual layers are not represented here at all:
    /// which tile is painted where is a presentation concern, and letting art
    /// decide collision is exactly the coupling the browser edition's map tools
    /// were built to avoid.
    ///
    /// Coordinates are y-up. Map files authored in the browser store rows
    /// top-down, so the two <c>From…</c> builders flip once on the way in and
    /// nothing downstream has to think about it again.
    /// </summary>
    public sealed class GridMap
    {
        private readonly bool[] walkable;
        private readonly HashSet<MapEdge> hardEdges;

        private GridMap(int width, int height, bool[] walkable, IEnumerable<MapEdge> hardEdges, GridPos entrance, GridPos stairs)
        {
            Width = width;
            Height = height;
            this.walkable = walkable;
            this.hardEdges = hardEdges == null ? new HashSet<MapEdge>() : new HashSet<MapEdge>(hardEdges);
            Entrance = entrance;
            Stairs = stairs;
        }

        public int Width { get; }

        public int Height { get; }

        /// <summary>Where the protagonist arrives, and where returning to the shop
        /// is possible.</summary>
        public GridPos Entrance { get; }

        public GridPos Stairs { get; }

        /// <summary>
        /// Builds from character rows given top-down, as in the authored layout
        /// JSON: '#' blocks, anything else walks.
        /// </summary>
        public static GridMap FromRows(IReadOnlyList<string> rowsTopDown, GridPos entrance, GridPos stairs, IEnumerable<MapEdge> hardEdges = null)
        {
            if (rowsTopDown == null || rowsTopDown.Count == 0) throw new ArgumentException("A map needs at least one row.", nameof(rowsTopDown));

            var height = rowsTopDown.Count;
            var width = rowsTopDown[0].Length;
            var cells = new bool[width * height];

            for (var row = 0; row < height; row++)
            {
                var line = rowsTopDown[row];
                if (line.Length != width) throw new ArgumentException($"Row {row} is {line.Length} wide; expected {width}.", nameof(rowsTopDown));

                var y = height - 1 - row;
                for (var x = 0; x < width; x++)
                    cells[y * width + x] = line[x] != '#';
            }

            return new GridMap(width, height, cells, hardEdges, entrance, stairs);
        }

        /// <summary>
        /// Builds from the browser map editor's flat collision array, which is
        /// row-major top-down with 0 = walkable and 1 = blocked.
        /// </summary>
        public static GridMap FromCollisionGrid(IReadOnlyList<int> collisionTopDown, int width, int height, GridPos entrance, GridPos stairs, IEnumerable<MapEdge> hardEdges = null)
        {
            if (collisionTopDown == null || collisionTopDown.Count != width * height)
                throw new ArgumentException($"Collision grid must hold {width * height} cells.", nameof(collisionTopDown));

            var cells = new bool[width * height];
            for (var row = 0; row < height; row++)
            for (var x = 0; x < width; x++)
                cells[(height - 1 - row) * width + x] = collisionTopDown[row * width + x] == 0;

            return new GridMap(width, height, cells, hardEdges, entrance, stairs);
        }

        public bool InBounds(GridPos position)
        {
            return position.X >= 0 && position.Y >= 0 && position.X < Width && position.Y < Height;
        }

        /// <summary>Cell occupancy only. Use <see cref="CanTraverse"/> to judge a
        /// step, because a wall can sit on the border between two open cells.</summary>
        public bool IsWalkable(GridPos position)
        {
            return InBounds(position) && walkable[position.Y * Width + position.X];
        }

        /// <summary>
        /// The only rule for crossing a cell border. Diagonals are never
        /// traversable: adjacency in this game is orthogonal, so the guard, the
        /// enemies and the shove all agree on what "next to" means.
        /// </summary>
        public bool CanTraverse(GridPos from, GridPos to)
        {
            var edge = MapEdge.Between(from, to);
            if (!edge.HasValue) return false;
            if (!IsWalkable(from) || !IsWalkable(to)) return false;
            return !hardEdges.Contains(edge.Value);
        }

        public bool HasHardEdge(GridPos from, GridPos to)
        {
            var edge = MapEdge.Between(from, to);
            return edge.HasValue && hardEdges.Contains(edge.Value);
        }

        /// <summary>Every cell reachable on foot from a starting cell. Used to
        /// validate that an authored map does not strand its stairs.</summary>
        public HashSet<GridPos> ReachableFrom(GridPos start)
        {
            var reached = new HashSet<GridPos>();
            if (!IsWalkable(start)) return reached;

            var queue = new Queue<GridPos>();
            queue.Enqueue(start);
            reached.Add(start);

            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                foreach (var step in GridPos.Orthogonal)
                {
                    var next = current + step;
                    if (reached.Contains(next) || !CanTraverse(current, next)) continue;
                    reached.Add(next);
                    queue.Enqueue(next);
                }
            }

            return reached;
        }
    }
}
