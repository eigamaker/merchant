using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// The shop floor while the shop is open, advanced one fixed tick at a time.
    ///
    /// Fixed ticks rather than a variable delta because a queue, a patience timer
    /// and a walking speed are all easier to reason about in whole steps — and
    /// because a test can run a whole trading day by calling <see cref="Tick"/> in
    /// a loop, with no waiting and no frame-rate dependence.
    ///
    /// A customer decides what to buy on the way in and claims it immediately.
    /// Choosing at the shelf instead would let two shoppers reach for the same
    /// piece and need an unwinding rule; reserving up front means that can never
    /// arise.
    /// </summary>
    public sealed class ShopSimulation
    {
        /// <summary>Ten ticks a second. Menus pause the simulation by simply not
        /// calling Tick.</summary>
        public const float TickSeconds = 0.1f;

        private const int MinSpawnGap = 40;
        private const int MaxSpawnGap = 110;
        private const int MaxCustomers = 4;

        private readonly ItemLedger ledger;
        private readonly InventoryService inventory;
        private readonly SalesService sales;
        private readonly GameState state;
        private readonly IReadOnlyList<CustomerDefinition> customers;

        public ShopSimulation(
            ItemLedger ledger,
            InventoryService inventory,
            SalesService sales,
            GameState state,
            IReadOnlyList<CustomerDefinition> customers)
        {
            this.ledger = ledger;
            this.inventory = inventory;
            this.sales = sales;
            this.state = state;
            this.customers = customers;
        }

        public void Open(ShopState shop)
        {
            shop.Phase = ShopPhase.Open;
            shop.NextSpawnTick = shop.Tick + 5;
        }

        /// <summary>Stops new arrivals. Trading ends once the last shopper is out,
        /// which is what advances the day.</summary>
        public void BeginClosing(ShopState shop)
        {
            if (shop.Phase == ShopPhase.Open) shop.Phase = ShopPhase.ClosingUp;
        }

        public void Tick(ShopState shop, ShopLayout layout)
        {
            if (!shop.IsTrading) return;

            shop.Tick++;
            if (shop.Phase == ShopPhase.Open) TrySpawn(shop, layout);

            foreach (var visit in shop.Customers.ToArray())
                Advance(shop, layout, visit);

            shop.Customers.RemoveAll(visit => !visit.IsPresent);
            CompactQueue(shop, layout);

            if (shop.Phase == ShopPhase.ClosingUp && shop.Customers.Count == 0) shop.Phase = ShopPhase.Closed;
        }

        private void TrySpawn(ShopState shop, ShopLayout layout)
        {
            if (shop.Tick < shop.NextSpawnTick || shop.Customers.Count >= MaxCustomers) return;
            if (shop.CustomerAt(layout.CustomerEntrance) != null) return;

            var rng = new Rng(shop.Seed + shop.Tick * 17);
            shop.NextSpawnTick = shop.Tick + rng.Int(MinSpawnGap, MaxSpawnGap);

            var definition = customers[rng.Int(0, customers.Count - 1)];
            shop.Customers.Add(new CustomerVisit($"visit-{++shop.VisitSerial}", definition, layout.CustomerEntrance));
            shop.VisitsToday++;
        }

        private void Advance(ShopState shop, ShopLayout layout, CustomerVisit visit)
        {
            switch (visit.Phase)
            {
                case CustomerPhase.Entering:
                case CustomerPhase.Browsing:
                    Decide(shop, layout, visit);
                    break;

                case CustomerPhase.WalkingToWare:
                    WalkToWare(shop, layout, visit);
                    break;

                case CustomerPhase.Taking:
                    TakeWare(shop, layout, visit);
                    break;

                case CustomerPhase.Queueing:
                    WalkToQueue(shop, layout, visit);
                    break;

                case CustomerPhase.AtCounter:
                    WaitForService(shop, layout, visit);
                    break;

                case CustomerPhase.Leaving:
                    WalkOut(shop, layout, visit);
                    break;
            }
        }

        /// <summary>
        /// Picks a ware and claims it on the spot. A shopper who finds nothing they
        /// want turns around — one of the three documented reasons to leave empty
        /// handed, and the one that tells the merchant their stock is wrong.
        /// </summary>
        private void Decide(ShopState shop, ShopLayout layout, CustomerVisit visit)
        {
            foreach (var shelf in layout.Shelves)
            for (var slot = 0; slot < shelf.SlotCount; slot++)
            {
                var item = ledger.OnShelfSlot(shelf.Id, slot);
                if (!sales.WouldBuy(item, visit.Definition)) continue;
                if (!inventory.TryReserve(item.Uuid, visit.Id)) continue;

                visit.TargetShelfId = shelf.Id;
                visit.TargetSlotIndex = slot;
                visit.HeldItemUuid = item.Uuid;
                visit.Phase = CustomerPhase.WalkingToWare;
                return;
            }

            visit.Phase = CustomerPhase.Leaving;
            shop.WalkoutsToday++;
        }

        private void WalkToWare(ShopState shop, ShopLayout layout, CustomerVisit visit)
        {
            var shelf = layout.ShelfById(visit.TargetShelfId);
            if (shelf == null)
            {
                Abandon(shop, visit);
                return;
            }

            if (visit.Position == shelf.AccessCell)
            {
                visit.Phase = CustomerPhase.Taking;
                return;
            }

            if (!Step(shop, layout, visit, shelf.AccessCell)) Abandon(shop, visit);
        }

        private void TakeWare(ShopState shop, ShopLayout layout, CustomerVisit visit)
        {
            var result = inventory.TryMove(visit.HeldItemUuid, ItemLocation.HeldByCustomer(visit.Id));
            if (!result.Success)
            {
                Abandon(shop, visit);
                return;
            }

            visit.Phase = CustomerPhase.Queueing;
            if (!shop.Queue.Contains(visit.Id)) shop.Queue.Add(visit.Id);
        }

        private void WalkToQueue(ShopState shop, ShopLayout layout, CustomerVisit visit)
        {
            var place = shop.Queue.IndexOf(visit.Id);
            if (place < 0)
            {
                shop.Queue.Add(visit.Id);
                return;
            }

            // Anyone past the end of the authored queue waits where they are rather
            // than piling onto one cell.
            var target = layout.QueueCells[place < layout.QueueCells.Count ? place : layout.QueueCells.Count - 1];
            if (visit.Position == target)
            {
                if (place == 0) visit.Phase = CustomerPhase.AtCounter;
                return;
            }

            if (!Step(shop, layout, visit, target)) visit.WaitTicks++;
        }

        private void WaitForService(ShopState shop, ShopLayout layout, CustomerVisit visit)
        {
            visit.WaitTicks++;
            if (visit.WaitTicks < visit.Definition.PatienceTicks) return;

            // Out of patience. The ware goes back on the shelf, so nothing is lost
            // except the sale and a little goodwill.
            Abandon(shop, visit);
        }

        private void WalkOut(ShopState shop, ShopLayout layout, CustomerVisit visit)
        {
            if (visit.Position == layout.CustomerEntrance)
            {
                visit.Phase = CustomerPhase.Left;
                shop.Queue.Remove(visit.Id);
                return;
            }

            // A shopper who cannot find the door still has to leave, or they would
            // block the room forever.
            if (!Step(shop, layout, visit, layout.CustomerEntrance)) visit.Phase = CustomerPhase.Left;
        }

        /// <summary>
        /// Completes the sale at the counter. Called by the player's action rather
        /// than by the simulation: the merchant has to be standing there, which is
        /// what gives leaving the counter a cost.
        /// </summary>
        public SaleRecord Serve(ShopState shop, CustomerVisit visit)
        {
            if (visit == null || visit.Phase != CustomerPhase.AtCounter) return null;
            if (!ledger.TryGet(visit.HeldItemUuid, out var item)) return null;

            var record = sales.Sell(item, visit.Definition);
            if (record == null) return null;

            shop.TakingsToday += record.Price;
            shop.SalesToday++;
            visit.Bought = true;
            visit.HeldItemUuid = null;
            visit.Phase = CustomerPhase.Leaving;
            shop.Queue.Remove(visit.Id);
            return record;
        }

        private void Abandon(ShopState shop, CustomerVisit visit)
        {
            if (visit.HeldItemUuid != null && ledger.TryGet(visit.HeldItemUuid, out var item))
                sales.ReturnToStock(item, visit.TargetShelfId, visit.TargetSlotIndex);

            visit.HeldItemUuid = null;
            visit.Phase = CustomerPhase.Leaving;
            shop.Queue.Remove(visit.Id);
            shop.WalkoutsToday++;
        }

        /// <summary>Moves one cell along a path, no more often than the customer's
        /// walking speed allows. Returns false when there is no route at all.</summary>
        private bool Step(ShopState shop, ShopLayout layout, CustomerVisit visit, GridPos target)
        {
            if (visit.StepCooldown > 0)
            {
                visit.StepCooldown--;
                return true;
            }

            var blocked = new HashSet<GridPos>();
            foreach (var other in shop.Customers)
                if (other != visit && other.IsPresent)
                    blocked.Add(other.Position);

            var step = GridPathfinding.NextStep(layout.Floor, visit.Position, new[] { target }, blocked);
            if (!step.HasValue)
            {
                // Blocked only by other shoppers is a traffic jam, not a dead end:
                // wait for them to move rather than giving up on the purchase.
                var withoutCrowd = GridPathfinding.NextStep(layout.Floor, visit.Position, new[] { target }, null);
                return withoutCrowd.HasValue;
            }

            visit.Position = step.Value;
            visit.StepCooldown = visit.Definition.TicksPerStep;
            return true;
        }

        /// <summary>Closes gaps so the next shopper moves up to the counter.</summary>
        private static void CompactQueue(ShopState shop, ShopLayout layout)
        {
            shop.Queue.RemoveAll(id =>
            {
                var visit = shop.CustomerById(id);
                return visit == null || (visit.Phase != CustomerPhase.Queueing && visit.Phase != CustomerPhase.AtCounter);
            });

            for (var i = 0; i < shop.Queue.Count; i++)
            {
                var visit = shop.CustomerById(shop.Queue[i]);
                if (visit == null) continue;

                var target = layout.QueueCells[i < layout.QueueCells.Count ? i : layout.QueueCells.Count - 1];
                if (visit.Position != target && visit.Phase == CustomerPhase.AtCounter) visit.Phase = CustomerPhase.Queueing;
            }
        }
    }
}
