using Merchan.Domain;
using UnityEngine;

namespace Merchan.Unity
{
    public static class ShopAuthoringUtility
    {
        /// <summary>One cell is one unit, centred on the half. The inverse of
        /// <see cref="GridActorView.ToWorld"/>.</summary>
        public static GridPos ToCell(Vector3 world)
        {
            return new GridPos(Mathf.FloorToInt(world.x), Mathf.FloorToInt(world.y));
        }
    }
}
