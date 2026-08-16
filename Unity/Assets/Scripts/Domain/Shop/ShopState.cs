using System.Collections.Generic;

namespace Merchan.Domain
{
    public enum ShopPhase
    {
        Closed,
        Open,
        /// <summary>The door is shut to new arrivals, but whoever is already inside
        /// gets to finish. Trading stops when the last of them leaves.</summary>
        ClosingUp
    }

    public enum CustomerPhase
    {
        Entering,
        /// <summary>Looking for something worth crossing the room for.</summary>
        Browsing,
        WalkingToWare,
        Taking,
        Queueing,
        /// <summary>At the head of the queue, waiting for the merchant.</summary>
        AtCounter,
        Leaving,
        Left
    }

    /// <summary>One shopper's visit. A new one is created each time they come in,
    /// so nothing carries over except the relationship held elsewhere.</summary>
    public sealed class CustomerVisit
    {
        public CustomerVisit(string id, CustomerDefinition definition, GridPos position)
        {
            Id = id;
            Definition = definition;
            Position = position;
            Phase = CustomerPhase.Entering;
        }

        public string Id { get; }

        public CustomerDefinition Definition { get; }

        public GridPos Position { get; internal set; }

        public CustomerPhase Phase { get; internal set; }

        public string TargetShelfId { get; internal set; }

        public int TargetSlotIndex { get; internal set; } = -1;

        /// <summary>The ware they have claimed, then carried. Cleared once paid for
        /// or put back.</summary>
        public string HeldItemUuid { get; internal set; }

        /// <summary>Ticks spent queueing. Compared against the definition's patience
        /// so a merchant who wanders off actually loses sales.</summary>
        public int WaitTicks { get; internal set; }

        internal int StepCooldown { get; set; }

        public bool Bought { get; internal set; }

        public bool IsPresent => Phase != CustomerPhase.Left;
    }

    /// <summary>
    /// A trading day in progress. Time here is counted in fixed ticks rather than
    /// seconds so the whole thing can be stepped in a test without waiting.
    /// </summary>
    public sealed class ShopState
    {
        public ShopState(int seed)
        {
            Seed = seed;
            Customers = new List<CustomerVisit>();
            Queue = new List<string>();
            Phase = ShopPhase.Closed;
        }

        public int Seed { get; }

        public ShopPhase Phase { get; internal set; }

        public int Tick { get; internal set; }

        public List<CustomerVisit> Customers { get; }

        /// <summary>Customer ids, front first.</summary>
        public List<string> Queue { get; }

        public int TakingsToday { get; internal set; }

        public int SalesToday { get; internal set; }

        public int VisitsToday { get; internal set; }

        /// <summary>Left without buying — the number to watch when tuning stock.</summary>
        public int WalkoutsToday { get; internal set; }

        internal int NextSpawnTick { get; set; }

        internal int VisitSerial { get; set; }

        public bool IsTrading => Phase == ShopPhase.Open || Phase == ShopPhase.ClosingUp;

        public CustomerVisit CustomerById(string id)
        {
            foreach (var visit in Customers)
                if (visit.Id == id)
                    return visit;
            return null;
        }

        public CustomerVisit CustomerAt(GridPos cell)
        {
            foreach (var visit in Customers)
                if (visit.IsPresent && visit.Position == cell)
                    return visit;
            return null;
        }

        /// <summary>The shopper the merchant can serve right now, if any.</summary>
        public CustomerVisit AtCounter()
        {
            if (Queue.Count == 0) return null;
            var head = CustomerById(Queue[0]);
            return head != null && head.Phase == CustomerPhase.AtCounter ? head : null;
        }

        public void ResetDay()
        {
            Customers.Clear();
            Queue.Clear();
            Tick = 0;
            TakingsToday = 0;
            SalesToday = 0;
            VisitsToday = 0;
            WalkoutsToday = 0;
            NextSpawnTick = 0;
            Phase = ShopPhase.Closed;
        }
    }
}
