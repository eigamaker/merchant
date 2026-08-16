using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// The shape the browser map editor exports (src/review/manualMapModel.ts).
    ///
    /// Plain fields with no attributes, matching the save DTOs: the Unity layer
    /// parses the JSON with Newtonsoft and hands the result here, so this assembly
    /// stays free of any serializer. Visual layers are deliberately absent — art
    /// is not allowed to decide collision.
    /// </summary>
    public sealed class ManualMapPackDto
    {
        public int Version;
        public List<ManualMapDto> Maps = new List<ManualMapDto>();
    }

    public sealed class ManualMapDto
    {
        public const int SupportedVersion = 2;

        public int Version;
        public string Id;
        public string Name;
        public string Kind;
        public int Width;
        public int Height;

        /// <summary>Row-major, top-down. 0 walks, 1 blocks.</summary>
        public int[] Collision;

        /// <summary>Keys of the form "x,y,east" or "x,y,south", in the editor's
        /// y-down space.</summary>
        public string[] HardEdges;

        public ManualPointDto Entrance;
        public ManualPointDto Stairs;
    }

    public sealed class ManualPointDto
    {
        public int X;
        public int Y;
    }
}
