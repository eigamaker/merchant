namespace Merchan.Domain
{
    /// <summary>
    /// Which way the protagonist is looking. Facing drives the contextual `E`
    /// action, so it is domain state rather than a presentation detail: the
    /// same facing decides both the prompt text and what the action resolves to.
    /// </summary>
    public enum Facing
    {
        Up,
        Right,
        Down,
        Left
    }

    public static class FacingExtensions
    {
        public static GridPos ToStep(this Facing facing)
        {
            switch (facing)
            {
                case Facing.Up: return GridPos.Up;
                case Facing.Right: return GridPos.Right;
                case Facing.Down: return GridPos.Down;
                default: return GridPos.Left;
            }
        }

        /// <summary>Turning does not consume a dungeon turn, so a step that maps
        /// to no direction leaves the current facing untouched.</summary>
        public static Facing FromStep(GridPos step, Facing fallback)
        {
            if (step.X > 0) return Facing.Right;
            if (step.X < 0) return Facing.Left;
            if (step.Y > 0) return Facing.Up;
            if (step.Y < 0) return Facing.Down;
            return fallback;
        }
    }
}
