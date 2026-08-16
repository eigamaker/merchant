using System.Collections.Generic;

namespace Merchan.Domain
{
    public interface IItemCatalog
    {
        bool TryGet(string definitionId, out ItemDefinition definition);

        ItemDefinition Get(string definitionId);
    }

    /// <summary>
    /// Lookup for authored item data. The domain takes this as an interface so
    /// tests can supply a handful of definitions instead of loading the full
    /// Unity asset set.
    /// </summary>
    public sealed class ItemCatalog : IItemCatalog
    {
        private readonly Dictionary<string, ItemDefinition> byId = new Dictionary<string, ItemDefinition>();

        public ItemCatalog(IEnumerable<ItemDefinition> definitions)
        {
            foreach (var definition in definitions)
                byId[definition.Id] = definition;
        }

        public IEnumerable<ItemDefinition> All => byId.Values;

        public bool TryGet(string definitionId, out ItemDefinition definition)
        {
            if (definitionId == null)
            {
                definition = null;
                return false;
            }
            return byId.TryGetValue(definitionId, out definition);
        }

        public ItemDefinition Get(string definitionId)
        {
            if (!TryGet(definitionId, out var definition))
                throw new KeyNotFoundException($"Unknown item definition: {definitionId}");
            return definition;
        }
    }
}
