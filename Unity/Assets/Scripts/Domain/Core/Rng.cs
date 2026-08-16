namespace Merchan.Domain
{
    /// <summary>
    /// The mulberry32 generator used by the browser edition (src/game/rng.ts).
    /// Keeping the exact bit pattern lets a dungeon seed produce the same
    /// sequence in both implementations, so EditMode tests stay reproducible
    /// and browser playtests remain a valid reference.
    /// </summary>
    public sealed class Rng
    {
        private const uint Fallback = 0x6d2b79f5u;

        private uint state;

        public Rng(int seed)
        {
            var initial = unchecked((uint)seed);
            state = initial == 0u ? Fallback : initial;
        }

        public double Next()
        {
            unchecked
            {
                state += Fallback;
                var t = state;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }

        /// <summary>Inclusive on both ends, matching the browser's Rng.int.</summary>
        public int Int(int min, int max)
        {
            return (int)System.Math.Floor(Next() * (max - min + 1)) + min;
        }

        public T Pick<T>(System.Collections.Generic.IReadOnlyList<T> values)
        {
            return values[Int(0, values.Count - 1)];
        }
    }
}
