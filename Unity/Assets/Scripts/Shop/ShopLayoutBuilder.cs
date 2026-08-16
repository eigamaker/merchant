using System.Collections.Generic;
using Merchan.Domain;
using UnityEngine;

namespace Merchan.Unity
{
    /// <summary>
    /// Reads the fixtures placed in the scene and produces the plain-C# layout the
    /// rules work with. Nothing downstream ever touches a Transform.
    ///
    /// Walkability comes from a plain room rectangle with the furniture punched
    /// out. A tilemap would be more flexible, but every shelf slot would then have
    /// to be painted solid by hand and kept in step with the fixture that owns it
    /// — the exact mismatch <see cref="ShopLayout.Validate"/> exists to catch.
    /// Deriving it means it cannot drift.
    /// </summary>
    public static class ShopLayoutBuilder
    {
        public static ShopLayout Build(Transform root, int width, int height, out IReadOnlyList<string> problems)
        {
            var shelves = new List<ShelfFixture>();
            var solid = new HashSet<GridPos>();
            var queue = new List<ShopMarkerAuthoring>();

            GridPos? entrance = null, dungeonExit = null, storage = null, clerk = null;

            foreach (var shelf in root.GetComponentsInChildren<ShelfAuthoring>())
            {
                var fixture = shelf.ToFixture();
                shelves.Add(fixture);
                // Wares sit on furniture, so a slot is solid by definition.
                foreach (var cell in fixture.SlotCells) solid.Add(cell);
            }

            foreach (var marker in root.GetComponentsInChildren<ShopMarkerAuthoring>())
            {
                switch (marker.Kind)
                {
                    case ShopMarkerKind.CustomerEntrance: entrance = marker.Cell; break;
                    case ShopMarkerKind.DungeonExit: dungeonExit = marker.Cell; break;
                    case ShopMarkerKind.Storage: storage = marker.Cell; break;
                    case ShopMarkerKind.Clerk: clerk = marker.Cell; break;
                    case ShopMarkerKind.QueueSlot: queue.Add(marker); break;
                    case ShopMarkerKind.Solid: solid.Add(marker.Cell); break;
                }
            }

            queue.Sort((a, b) => a.Order.CompareTo(b.Order));

            var missing = new List<string>();
            if (!entrance.HasValue) missing.Add("no customer entrance is marked");
            if (!clerk.HasValue) missing.Add("no counter is marked");
            if (!storage.HasValue) missing.Add("no storage is marked");
            if (!dungeonExit.HasValue) missing.Add("no dungeon exit is marked");
            if (missing.Count > 0)
            {
                problems = missing;
                return null;
            }

            // The door is a gap in the wall, so it stays walkable even though it
            // sits on the edge of the room.
            var layout = new ShopLayout(
                BuildFloor(width, height, solid, entrance.Value),
                entrance.Value,
                dungeonExit.Value,
                storage.Value,
                clerk.Value,
                queue.ConvertAll(marker => marker.Cell),
                shelves);

            problems = layout.Validate();
            return layout;
        }

        /// <summary>A walled rectangle with the furniture cells filled in and the
        /// doorway cut back out.</summary>
        private static GridMap BuildFloor(int width, int height, HashSet<GridPos> solid, GridPos doorway)
        {
            var rows = new string[height];
            for (var row = 0; row < height; row++)
            {
                var y = height - 1 - row;
                var line = new char[width];
                for (var x = 0; x < width; x++)
                {
                    var cell = new GridPos(x, y);
                    if (cell == doorway)
                    {
                        line[x] = '.';
                        continue;
                    }

                    var onEdge = x == 0 || y == 0 || x == width - 1 || y == height - 1;
                    line[x] = onEdge || solid.Contains(cell) ? '#' : '.';
                }
                rows[row] = new string(line);
            }

            return GridMap.FromRows(rows, new GridPos(1, 1), new GridPos(1, 1));
        }
    }
}
