using System;

namespace Merchan.Domain
{
    /// <summary>
    /// A cell on a dungeon or shop grid. One cell is one Unity unit, and y
    /// grows upwards, so domain coordinates can be used as world coordinates
    /// without a per-call conversion. Map files authored in the browser tool
    /// use y-down and are flipped once, at load time.
    /// </summary>
    public readonly struct GridPos : IEquatable<GridPos>
    {
        public readonly int X;
        public readonly int Y;

        public GridPos(int x, int y)
        {
            X = x;
            Y = y;
        }

        public static GridPos Up => new GridPos(0, 1);
        public static GridPos Down => new GridPos(0, -1);
        public static GridPos Left => new GridPos(-1, 0);
        public static GridPos Right => new GridPos(1, 0);

        /// <summary>The four orthogonal steps, in a fixed order so that AI that
        /// iterates them stays deterministic.</summary>
        public static readonly GridPos[] Orthogonal = { Up, Right, Down, Left };

        public static GridPos operator +(GridPos a, GridPos b) => new GridPos(a.X + b.X, a.Y + b.Y);

        public static GridPos operator -(GridPos a, GridPos b) => new GridPos(a.X - b.X, a.Y - b.Y);

        public static bool operator ==(GridPos a, GridPos b) => a.Equals(b);

        public static bool operator !=(GridPos a, GridPos b) => !a.Equals(b);

        /// <summary>Manhattan distance. Adjacency in this game is orthogonal, so
        /// "distance == 1" is the single adjacency test used by every brain.</summary>
        public static int Distance(GridPos a, GridPos b)
        {
            return Math.Abs(a.X - b.X) + Math.Abs(a.Y - b.Y);
        }

        /// <summary>
        /// Distance counting a diagonal as one. Movement and attacks are
        /// orthogonal, so this is not the general adjacency test — it exists for
        /// the escort's parry, which has to be able to reach a threat standing
        /// diagonally from it.
        ///
        /// Two orthogonally adjacent cells share no orthogonal neighbour, so an
        /// escort beside the merchant is always diagonal to an enemy that has just
        /// stepped up to them. Measured with <see cref="Distance"/>, intercepting
        /// could never happen at all.
        /// </summary>
        public static int ReachDistance(GridPos a, GridPos b)
        {
            return Math.Max(Math.Abs(a.X - b.X), Math.Abs(a.Y - b.Y));
        }

        public bool Equals(GridPos other) => X == other.X && Y == other.Y;

        public override bool Equals(object obj) => obj is GridPos other && Equals(other);

        public override int GetHashCode() => unchecked((X * 397) ^ Y);

        public override string ToString() => $"({X},{Y})";
    }
}
