using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Turns defeated enemies into searchable remnants, and hands their contents
    /// over when the merchant spends a turn looking.
    ///
    /// A defeat produces exactly one container and never scatters items on the
    /// floor. Only chests and urns — things that are not bodies — drop directly.
    /// Keeping the two mechanisms apart stops the same find being announced twice.
    ///
    /// Contents are rolled the moment the enemy falls, not when the remnant is
    /// searched, so what is inside survives a save and does not change if the
    /// player walks away and comes back.
    /// </summary>
    public sealed class LootService
    {
        private readonly ItemLedger ledger;
        private readonly LootTableCatalog lootTables;
        private readonly InventoryService inventory;
        private readonly GameState state;

        private int remnantSerial;

        public LootService(ItemLedger ledger, LootTableCatalog lootTables, InventoryService inventory, GameState state)
        {
            this.ledger = ledger;
            this.lootTables = lootTables;
            this.inventory = inventory;
            this.state = state;
        }

        public void DefeatEnemy(DungeonRunState run, EnemyActor enemy, List<DungeonEvent> events)
        {
            run.Enemies.Remove(enemy);
            events.Add(DungeonEvent.Defeated(enemy.Id));

            var container = new DungeonContainer(
                $"remnant-{++remnantSerial}",
                ContainerKind.Remnant,
                enemy.Name,
                enemy.Position,
                enemy.Definition.Remnant);
            run.Containers.Add(container);
            events.Add(DungeonEvent.RemnantLeft(container.Id, container.Position));

            RollInto(run, container, enemy.Definition.LootTableId);
        }

        private void RollInto(DungeonRunState run, DungeonContainer container, string lootTableId)
        {
            if (!lootTables.TryGet(lootTableId, out var table)) return;

            // Seeded from the run and the cell, so the same kill on a replayed run
            // yields the same remnant regardless of what else happened that turn.
            var rng = new Rng(run.Seed + run.Turn * 91 + container.Position.X * 31 + container.Position.Y);
            var entry = table.Roll(rng);
            if (entry.IsNothing) return;

            var quantity = entry.Minimum == entry.Maximum ? entry.Minimum : rng.Int(entry.Minimum, entry.Maximum);
            ledger.Create(entry.DefinitionId, state.Day, run.Floor, ItemLocation.InDungeonContainer(container.Id), quantity);
        }

        public IReadOnlyList<ItemInstance> Contents(DungeonContainer container)
        {
            var contents = new List<ItemInstance>();
            foreach (var item in ledger.All)
                if (item.Location == ItemLocation.InDungeonContainer(container.Id))
                    contents.Add(item);
            return contents;
        }

        /// <summary>
        /// Spends the turn looking. An empty remnant is a real outcome, not a
        /// failure — that is what stops searching from being automatic.
        /// </summary>
        public void Search(DungeonContainer container, List<DungeonEvent> events)
        {
            container.Searched = true;
            var contents = Contents(container);
            events.Add(DungeonEvent.ContainerSearched(container.Id, contents.Count));
        }

        /// <summary>Takes one item out of an already-searched container. Fails when
        /// the bag has no room, leaving the item where it is.</summary>
        public bool TryTake(DungeonContainer container, string itemUuid, List<DungeonEvent> events)
        {
            if (!container.Searched) return false;
            if (!ledger.TryGet(itemUuid, out var item)) return false;
            if (item.Location != ItemLocation.InDungeonContainer(container.Id)) return false;

            var result = inventory.TryPickUp(itemUuid);
            if (!result.Success) return false;

            events.Add(DungeonEvent.ItemTaken(result.ResultUuid));
            return true;
        }
    }
}
