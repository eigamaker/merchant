using System;

namespace Merchan.Unity
{
    /// <summary>Shared town data exported by the existing web edition.</summary>
    [Serializable]
    public sealed class TownLayout
    {
        public int tile;
        public int width;
        public int height;
        public TownPosition spawn;
        public TownBuilding[] buildings;
        public TownPoint[] points;
        public string[] collision;
    }

    [Serializable]
    public sealed class TownPosition
    {
        public int x;
        public int y;
    }

    [Serializable]
    public sealed class TownBuilding
    {
        public string id;
        public string name;
        public string kind;
        public string customerId;
        public int x;
        public int y;
        public int width;
        public int height;
        public TownPosition entrance;
    }

    [Serializable]
    public sealed class TownPoint
    {
        public string id;
        public string name;
        public string kind;
        public string customerId;
        public int x;
        public int y;
    }
}
