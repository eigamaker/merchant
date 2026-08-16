using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// One shelf: the cells its wares sit on, and the cell someone stands in to
    /// reach them. Slots are addressed by index, not by free position, because
    /// that is what keeps customer pathing, reservations and saves simple.
    /// </summary>
    public sealed class ShelfFixture
    {
        public ShelfFixture(string id, GridPos accessCell, IReadOnlyList<GridPos> slotCells)
        {
            Id = id;
            AccessCell = accessCell;
            SlotCells = slotCells;
        }

        public string Id { get; }

        /// <summary>Where a customer or the merchant stands to use the shelf.</summary>
        public GridPos AccessCell { get; }

        public IReadOnlyList<GridPos> SlotCells { get; }

        public int SlotCount => SlotCells.Count;

        public int SlotIndexAt(GridPos cell)
        {
            for (var i = 0; i < SlotCells.Count; i++)
                if (SlotCells[i] == cell)
                    return i;
            return -1;
        }
    }

    /// <summary>
    /// The home shop's fixed furniture. Authored in the Unity scene rather than in
    /// the browser map editor: it is one hand-made room, and placing a counter by
    /// dragging it is far easier than describing it in a map file.
    ///
    /// <see cref="Validate"/> exists because most of the ways this can be wrong —
    /// a shelf nobody can reach, a queue that does not lead to the counter — are
    /// invisible in the editor and only show up as customers standing still.
    /// </summary>
    public sealed class ShopLayout
    {
        public ShopLayout(
            GridMap floor,
            GridPos customerEntrance,
            GridPos dungeonExit,
            GridPos storageCell,
            GridPos clerkCell,
            IReadOnlyList<GridPos> queueCells,
            IReadOnlyList<ShelfFixture> shelves)
        {
            Floor = floor;
            CustomerEntrance = customerEntrance;
            DungeonExit = dungeonExit;
            StorageCell = storageCell;
            ClerkCell = clerkCell;
            QueueCells = queueCells;
            Shelves = shelves;
        }

        public GridMap Floor { get; }

        /// <summary>Customers arrive and leave here.</summary>
        public GridPos CustomerEntrance { get; }

        public GridPos DungeonExit { get; }

        public GridPos StorageCell { get; }

        /// <summary>Where the merchant must stand to take payment.</summary>
        public GridPos ClerkCell { get; }

        /// <summary>Ordered. The customer in <c>QueueCells[0]</c> is the one being
        /// served; the rest shuffle forward as it empties.</summary>
        public IReadOnlyList<GridPos> QueueCells { get; }

        public IReadOnlyList<ShelfFixture> Shelves { get; }

        public GridPos CheckoutCell => QueueCells.Count > 0 ? QueueCells[0] : ClerkCell;

        public ShelfFixture ShelfById(string id)
        {
            foreach (var shelf in Shelves)
                if (shelf.Id == id)
                    return shelf;
            return null;
        }

        /// <summary>The shelf a given cell belongs to, whether that cell is one of
        /// its slots or the spot you stand in to use it.</summary>
        public ShelfFixture ShelfAt(GridPos cell)
        {
            foreach (var shelf in Shelves)
            {
                if (shelf.AccessCell == cell || shelf.SlotIndexAt(cell) >= 0) return shelf;
            }
            return null;
        }

        /// <summary>
        /// Everything wrong with the authored room. A shop that fails any of these
        /// still loads; it just quietly does not work, which is exactly the kind of
        /// bug worth spending a validator on.
        /// </summary>
        public IReadOnlyList<string> Validate()
        {
            var problems = new List<string>();

            if (!Floor.IsWalkable(CustomerEntrance)) problems.Add("the customer entrance is not walkable");
            if (!Floor.IsWalkable(ClerkCell)) problems.Add("the merchant cannot stand at the counter");
            if (!Floor.IsWalkable(StorageCell)) problems.Add("the storage cell is not walkable");
            if (QueueCells.Count == 0) problems.Add("there is nowhere to queue");
            if (Shelves.Count == 0) problems.Add("there are no shelves");
            if (problems.Count > 0) return problems;

            var reachable = Floor.ReachableFrom(CustomerEntrance);

            foreach (var cell in QueueCells)
            {
                if (!Floor.IsWalkable(cell)) problems.Add($"queue cell {cell} is not walkable");
                else if (!reachable.Contains(cell)) problems.Add($"queue cell {cell} cannot be walked to");
            }

            // Payment happens across the counter, so the served customer and the
            // merchant have to be able to hand things to each other.
            if (GridPos.ReachDistance(CheckoutCell, ClerkCell) > 1)
                problems.Add("the front of the queue is not next to where the merchant stands");

            if (!reachable.Contains(StorageCell)) problems.Add("the storage cell cannot be walked to");

            foreach (var shelf in Shelves)
            {
                if (shelf.SlotCount == 0) problems.Add($"shelf '{shelf.Id}' has no slots");
                if (!Floor.IsWalkable(shelf.AccessCell)) problems.Add($"shelf '{shelf.Id}' cannot be stood at");
                else if (!reachable.Contains(shelf.AccessCell)) problems.Add($"shelf '{shelf.Id}' cannot be walked to");

                foreach (var slot in shelf.SlotCells)
                {
                    // Wares sit on furniture. A walkable slot means the shelf was
                    // drawn on open floor and customers would walk through it.
                    if (Floor.IsWalkable(slot)) problems.Add($"shelf '{shelf.Id}' has a slot at {slot} on open floor");
                    if (GridPos.ReachDistance(slot, shelf.AccessCell) > 1)
                        problems.Add($"shelf '{shelf.Id}' has a slot at {slot} out of arm's reach");
                }
            }

            return problems;
        }
    }
}
