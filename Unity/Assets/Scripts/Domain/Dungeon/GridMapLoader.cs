using System;
using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Converts an exported browser map into a playable floor.
    ///
    /// The editor works in y-down screen space; the game works in y-up world
    /// space. The flip happens here, once, and every coordinate downstream is
    /// already in world space. Edges are converted by naming the two cells they
    /// sit between and letting <see cref="MapEdge.Between"/> pick the canonical
    /// form, rather than by adjusting indices twice and hoping they agree.
    /// </summary>
    public static class GridMapLoader
    {
        public static GridMap FromManualMap(ManualMapDto dto)
        {
            var problems = Validate(dto);
            if (problems.Count > 0)
                throw new ArgumentException($"Map '{dto?.Id}' cannot be loaded: {string.Join("; ", problems)}", nameof(dto));

            return GridMap.FromCollisionGrid(
                dto.Collision,
                dto.Width,
                dto.Height,
                Flip(dto.Entrance, dto.Height),
                Flip(dto.Stairs, dto.Height),
                ParseEdges(dto.HardEdges, dto.Height));
        }

        /// <summary>
        /// Everything wrong with an authored map, as messages. Run this in an
        /// editor tool before shipping a map: a stranded staircase is invisible in
        /// the editor and obvious only once someone walks the floor.
        /// </summary>
        public static IReadOnlyList<string> Validate(ManualMapDto dto)
        {
            var problems = new List<string>();
            if (dto == null)
            {
                problems.Add("the map is missing");
                return problems;
            }

            if (dto.Version != ManualMapDto.SupportedVersion)
                problems.Add($"unsupported map version {dto.Version}, expected {ManualMapDto.SupportedVersion}");
            if (dto.Width <= 0 || dto.Height <= 0)
                problems.Add("width and height must both be positive");
            if (dto.Collision == null || dto.Collision.Length != dto.Width * dto.Height)
                problems.Add($"collision grid should hold {dto.Width * dto.Height} cells but holds {dto.Collision?.Length ?? 0}");
            if (dto.Entrance == null) problems.Add("no entrance is marked");
            if (dto.Stairs == null) problems.Add("no stairs are marked");
            if (problems.Count > 0) return problems;

            var map = GridMap.FromCollisionGrid(
                dto.Collision,
                dto.Width,
                dto.Height,
                Flip(dto.Entrance, dto.Height),
                Flip(dto.Stairs, dto.Height),
                ParseEdges(dto.HardEdges, dto.Height));

            if (!map.IsWalkable(map.Entrance)) problems.Add("the entrance stands in a wall");
            if (!map.IsWalkable(map.Stairs)) problems.Add("the stairs stand in a wall");
            if (problems.Count > 0) return problems;

            if (!map.ReachableFrom(map.Entrance).Contains(map.Stairs))
                problems.Add("the stairs cannot be walked to from the entrance");

            return problems;
        }

        private static GridPos Flip(ManualPointDto point, int height)
        {
            return point == null ? default : new GridPos(point.X, height - 1 - point.Y);
        }

        private static IEnumerable<MapEdge> ParseEdges(string[] keys, int height)
        {
            var edges = new List<MapEdge>();
            if (keys == null) return edges;

            foreach (var key in keys)
            {
                if (string.IsNullOrEmpty(key)) continue;
                var parts = key.Split(',');
                if (parts.Length != 3) continue;
                if (!int.TryParse(parts[0], out var x) || !int.TryParse(parts[1], out var y)) continue;

                var top = new GridPos(x, height - 1 - y);
                GridPos other;
                if (string.Equals(parts[2], "east", StringComparison.OrdinalIgnoreCase))
                    other = new GridPos(x + 1, top.Y);
                else if (string.Equals(parts[2], "south", StringComparison.OrdinalIgnoreCase))
                    // "South" in the editor is one row further down the screen,
                    // which is one lower y once flipped.
                    other = new GridPos(x, top.Y - 1);
                else
                    continue;

                var edge = MapEdge.Between(top, other);
                if (edge.HasValue) edges.Add(edge.Value);
            }

            return edges;
        }
    }
}
