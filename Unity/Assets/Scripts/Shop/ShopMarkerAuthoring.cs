using Merchan.Domain;
using UnityEngine;

namespace Merchan.Unity
{
    public enum ShopMarkerKind
    {
        CustomerEntrance,
        DungeonExit,
        Storage,
        /// <summary>Where the merchant stands to take payment.</summary>
        Clerk,
        /// <summary>One place in the queue. <see cref="ShopMarkerAuthoring.Order"/>
        /// 0 is the one being served.</summary>
        QueueSlot,
        /// <summary>Furniture or wall. Marked solid so nobody walks through it.</summary>
        Solid
    }

    /// <summary>
    /// A single tagged cell in the shop: the door, the counter, a queue place, a
    /// piece of furniture.
    ///
    /// This lives in its own file because Unity only resolves a MonoBehaviour to
    /// its script asset by GUID when the file is named after the class. Sharing a
    /// file with another component saves the scene with a dangling script
    /// reference, and the component silently does nothing at run time.
    /// </summary>
    public sealed class ShopMarkerAuthoring : MonoBehaviour
    {
        [SerializeField] private ShopMarkerKind kind = ShopMarkerKind.Solid;
        [Tooltip("Queue position, front first. Ignored by other kinds.")]
        [SerializeField] private int order;

        public ShopMarkerKind Kind => kind;

        public int Order => order;

        public GridPos Cell => ShopAuthoringUtility.ToCell(transform.position);

        public void Configure(ShopMarkerKind newKind, int newOrder = 0)
        {
            kind = newKind;
            order = newOrder;
        }

        private void OnDrawGizmos()
        {
            Gizmos.color = kind == ShopMarkerKind.Solid ? new Color(1f, 0.4f, 0.3f, 0.5f) : new Color(1f, 0.9f, 0.3f, 0.7f);
            Gizmos.DrawWireCube(transform.position, Vector3.one * 0.8f);
        }
    }
}
