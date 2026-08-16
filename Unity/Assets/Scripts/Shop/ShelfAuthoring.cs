using System.Collections.Generic;
using Merchan.Domain;
using UnityEngine;

namespace Merchan.Unity
{
    /// <summary>
    /// A shelf placed in the scene. The slot children are where wares are drawn;
    /// the access point is where a customer stands to reach them.
    ///
    /// The shop is authored here rather than in the browser map editor because it
    /// is one hand-made room — dragging a counter into place beats describing it
    /// in a map file, and only the dungeon has enough floors to be worth a
    /// pipeline.
    /// </summary>
    public sealed class ShelfAuthoring : MonoBehaviour
    {
        [SerializeField] private string shelfId = "shelf-a";
        [Tooltip("Where a customer stands. Defaults to one cell below this object.")]
        [SerializeField] private Transform accessPoint;
        [SerializeField] private Transform[] slots = new Transform[0];

        public string ShelfId => shelfId;

        public IReadOnlyList<Transform> Slots => slots;

        public GridPos AccessCell => ShopAuthoringUtility.ToCell(
            accessPoint != null ? accessPoint.position : transform.position + Vector3.down);

        public ShelfFixture ToFixture()
        {
            var cells = new List<GridPos>();
            foreach (var slot in slots)
                if (slot != null)
                    cells.Add(ShopAuthoringUtility.ToCell(slot.position));

            return new ShelfFixture(shelfId, AccessCell, cells);
        }

        private void OnDrawGizmos()
        {
            Gizmos.color = new Color(0.4f, 0.8f, 1f, 0.6f);
            foreach (var slot in slots)
                if (slot != null)
                    Gizmos.DrawWireCube(slot.position, Vector3.one * 0.9f);

            Gizmos.color = new Color(0.2f, 1f, 0.4f, 0.6f);
            Gizmos.DrawWireSphere(accessPoint != null ? accessPoint.position : transform.position + Vector3.down, 0.35f);
        }
    }
}
