using System;

namespace Merchan.Domain
{
    public enum EdgeDirection
    {
        East,
        South
    }

    /// <summary>
    /// The border between two neighbouring cells, stored once rather than once
    /// per side. `East` is the border between (x,y) and (x+1,y); `South` is the
    /// border below (x,y) — that is, towards (x,y-1) in the y-up domain space.
    ///
    /// Storing edges canonically is what keeps a wall from existing for one cell
    /// and not the other. Ported from src/game/dungeonRules.ts.
    /// </summary>
    public readonly struct MapEdge : IEquatable<MapEdge>
    {
        public MapEdge(int x, int y, EdgeDirection direction)
        {
            X = x;
            Y = y;
            Direction = direction;
        }

        public int X { get; }

        public int Y { get; }

        public EdgeDirection Direction { get; }

        /// <summary>The canonical edge crossed by a step, or null when the two
        /// cells are not orthogonally adjacent.</summary>
        public static MapEdge? Between(GridPos from, GridPos to)
        {
            if (from.Y == to.Y && Math.Abs(from.X - to.X) == 1)
                return new MapEdge(Math.Min(from.X, to.X), from.Y, EdgeDirection.East);
            if (from.X == to.X && Math.Abs(from.Y - to.Y) == 1)
                return new MapEdge(from.X, Math.Min(from.Y, to.Y), EdgeDirection.South);
            return null;
        }

        public bool Equals(MapEdge other) => X == other.X && Y == other.Y && Direction == other.Direction;

        public override bool Equals(object obj) => obj is MapEdge other && Equals(other);

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = X;
                hash = (hash * 397) ^ Y;
                hash = (hash * 397) ^ (int)Direction;
                return hash;
            }
        }

        public override string ToString() => $"{X},{Y},{Direction}";
    }
}
