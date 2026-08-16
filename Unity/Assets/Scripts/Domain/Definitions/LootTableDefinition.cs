using System.Collections.Generic;

namespace Merchan.Domain
{
    public sealed class LootTableEntry
    {
        /// <summary>A null definition id is the "nothing here" outcome. Empty
        /// remnants have to be possible, otherwise searching every corpse becomes
        /// automatic rather than a decision about spending a turn.</summary>
        public LootTableEntry(string definitionId, int weight, int minimum = 1, int maximum = 1)
        {
            DefinitionId = definitionId;
            Weight = weight < 1 ? 1 : weight;
            Minimum = minimum < 1 ? 1 : minimum;
            Maximum = maximum < Minimum ? Minimum : maximum;
        }

        public string DefinitionId { get; }

        public int Weight { get; }

        public int Minimum { get; }

        public int Maximum { get; }

        public bool IsNothing => string.IsNullOrEmpty(DefinitionId);

        public static LootTableEntry Nothing(int weight) => new LootTableEntry(null, weight);
    }

    public sealed class LootTableDefinition
    {
        private readonly List<LootTableEntry> entries;

        public LootTableDefinition(string id, IEnumerable<LootTableEntry> entries)
        {
            Id = id;
            this.entries = new List<LootTableEntry>(entries);
            foreach (var entry in this.entries) TotalWeight += entry.Weight;
        }

        public string Id { get; }

        public IReadOnlyList<LootTableEntry> Entries => entries;

        public int TotalWeight { get; }

        /// <summary>
        /// Picks one entry. Rolling from a running weight total keeps the result a
        /// pure function of the seed, so a remnant searched on a replayed run
        /// yields the same thing.
        /// </summary>
        public LootTableEntry Roll(Rng rng)
        {
            if (entries.Count == 0) return LootTableEntry.Nothing(1);

            var roll = rng.Int(1, TotalWeight);
            var running = 0;
            foreach (var entry in entries)
            {
                running += entry.Weight;
                if (roll <= running) return entry;
            }
            return entries[entries.Count - 1];
        }
    }

    public sealed class LootTableCatalog
    {
        private readonly Dictionary<string, LootTableDefinition> byId = new Dictionary<string, LootTableDefinition>();

        public LootTableCatalog(IEnumerable<LootTableDefinition> tables)
        {
            foreach (var table in tables) byId[table.Id] = table;
        }

        public bool TryGet(string id, out LootTableDefinition table)
        {
            if (id == null)
            {
                table = null;
                return false;
            }
            return byId.TryGetValue(id, out table);
        }
    }
}
