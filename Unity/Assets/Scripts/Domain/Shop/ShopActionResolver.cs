using System.Collections.Generic;

namespace Merchan.Domain
{
    public enum ShopActionKind
    {
        DisplayOnShelf,
        TakeFromShelf,
        StoreHeldItem,
        TakeFromStorage,
        ServeCustomer,
        OpenShop,
        CloseShop,
        LeaveForDungeon
    }

    /// <summary>One thing `E` could do in the shop, with the wording the field
    /// prompt shows.</summary>
    public sealed class ShopAction
    {
        public ShopAction(ShopActionKind kind, GridPos cell, string label, string shelfId = null, int slotIndex = -1, string itemUuid = null)
        {
            Kind = kind;
            Cell = cell;
            Label = label;
            ShelfId = shelfId;
            SlotIndex = slotIndex;
            ItemUuid = itemUuid;
        }

        public ShopActionKind Kind { get; }

        public GridPos Cell { get; }

        public string Label { get; }

        public string ShelfId { get; }

        public int SlotIndex { get; }

        public string ItemUuid { get; }
    }

    public sealed class ShopActionResult
    {
        private ShopActionResult(bool success, string message)
        {
            Success = success;
            Message = message;
        }

        public bool Success { get; }

        public string Message { get; }

        public static ShopActionResult Ok(string message) => new ShopActionResult(true, message);

        public static ShopActionResult Failed(string message) => new ShopActionResult(false, message);
    }

    /// <summary>
    /// The merchant's side of the shop: the same contextual `E` as the dungeon,
    /// resolved against shelves, the storage chest, the counter and the door.
    ///
    /// The single-item case is done here on the floor, by facing the thing and
    /// pressing one key. Bulk tidying is what the bag screen is for.
    /// </summary>
    public sealed class ShopActionResolver
    {
        private readonly GameState state;
        private readonly ItemLedger ledger;
        private readonly InventoryService inventory;
        private readonly QuickSlotService quickSlots;
        private readonly IItemCatalog catalog;
        private readonly SalesService sales;
        private readonly ShopSimulation simulation;

        public ShopActionResolver(
            GameState state,
            ItemLedger ledger,
            InventoryService inventory,
            QuickSlotService quickSlots,
            IItemCatalog catalog,
            SalesService sales,
            ShopSimulation simulation)
        {
            this.state = state;
            this.ledger = ledger;
            this.inventory = inventory;
            this.quickSlots = quickSlots;
            this.catalog = catalog;
            this.sales = sales;
            this.simulation = simulation;
        }

        /// <summary>Where the merchant is standing and which way they face is all
        /// that decides this — same rule as underground.</summary>
        public IReadOnlyList<ShopAction> Actions(ShopLayout layout, ShopState shop, GridPos position, Facing facing)
        {
            var actions = new List<ShopAction>();
            CollectAt(layout, shop, position + facing.ToStep(), position, actions);
            CollectAt(layout, shop, position, position, actions);
            return actions;
        }

        private void CollectAt(ShopLayout layout, ShopState shop, GridPos cell, GridPos merchantCell, List<ShopAction> actions)
        {
            var shelf = layout.ShelfAt(cell);
            if (shelf != null) CollectShelf(shelf, cell, actions);

            if (cell == layout.StorageCell) CollectStorage(actions, cell);

            if (merchantCell == layout.ClerkCell)
            {
                var waiting = shop.AtCounter();
                if (waiting != null && ledger.TryGet(waiting.HeldItemUuid, out var item))
                    actions.Add(new ShopAction(ShopActionKind.ServeCustomer, cell,
                        $"{waiting.Definition.Name}へ{sales.AskingPrice(item)}Gで会計する", itemUuid: waiting.HeldItemUuid));

                if (shop.Phase == ShopPhase.Closed)
                    actions.Add(new ShopAction(ShopActionKind.OpenShop, cell, "開店する"));
                else if (shop.Phase == ShopPhase.Open)
                    actions.Add(new ShopAction(ShopActionKind.CloseShop, cell, "閉店する"));
            }

            if (cell == layout.DungeonExit)
                actions.Add(new ShopAction(ShopActionKind.LeaveForDungeon, cell,
                    state.ExpeditionUsedToday ? "今日はもう探索できない" : "ダンジョンへ向かう"));
        }

        private void CollectShelf(ShelfFixture shelf, GridPos cell, List<ShopAction> actions)
        {
            var slot = shelf.SlotIndexAt(cell);

            // Standing at the shelf offers every slot; facing one slot offers just
            // that one, so aiming stays the way to be precise.
            var first = slot >= 0 ? slot : 0;
            var last = slot >= 0 ? slot : shelf.SlotCount - 1;

            for (var i = first; i <= last; i++)
            {
                var onShelf = ledger.OnShelfSlot(shelf.Id, i);
                if (onShelf != null)
                {
                    if (onShelf.IsReserved) continue;
                    actions.Add(new ShopAction(ShopActionKind.TakeFromShelf, cell,
                        $"{Name(onShelf)}を下げる", shelf.Id, i, onShelf.Uuid));
                    continue;
                }

                var held = quickSlots.Held();
                if (held == null) continue;
                actions.Add(new ShopAction(ShopActionKind.DisplayOnShelf, cell,
                    $"{Name(held)}を並べる", shelf.Id, i, held.Uuid));
            }
        }

        private void CollectStorage(List<ShopAction> actions, GridPos cell)
        {
            var held = quickSlots.Held();
            if (held != null)
                actions.Add(new ShopAction(ShopActionKind.StoreHeldItem, cell, $"{Name(held)}を保管する", itemUuid: held.Uuid));

            foreach (var stored in ledger.InShopStorage())
            {
                actions.Add(new ShopAction(ShopActionKind.TakeFromStorage, cell, $"{Name(stored)}を取り出す", itemUuid: stored.Uuid));
                break;
            }
        }

        private string Name(ItemInstance item)
        {
            return catalog.TryGet(item.DefinitionId, out var definition) ? definition.NameFor(item.Knowledge) : item.DefinitionId;
        }

        public ShopActionResult Execute(ShopLayout layout, ShopState shop, ShopAction action)
        {
            if (action == null) return ShopActionResult.Failed("ここには何もない。");

            switch (action.Kind)
            {
                case ShopActionKind.DisplayOnShelf:
                {
                    var result = inventory.TryMove(action.ItemUuid, ItemLocation.OnShelf(action.ShelfId, action.SlotIndex));
                    return result.Success
                        ? ShopActionResult.Ok("棚に並べた。")
                        : ShopActionResult.Failed("そこには置けない。");
                }

                case ShopActionKind.TakeFromShelf:
                {
                    var result = inventory.TryPickUp(action.ItemUuid);
                    return result.Success
                        ? ShopActionResult.Ok("棚から下げた。")
                        : ShopActionResult.Failed("道具袋がいっぱいだ。");
                }

                case ShopActionKind.StoreHeldItem:
                {
                    var result = inventory.TryMove(action.ItemUuid, ItemLocation.InShopStorage());
                    return result.Success ? ShopActionResult.Ok("保管した。") : ShopActionResult.Failed("しまえなかった。");
                }

                case ShopActionKind.TakeFromStorage:
                {
                    var result = inventory.TryPickUp(action.ItemUuid);
                    return result.Success
                        ? ShopActionResult.Ok("取り出した。")
                        : ShopActionResult.Failed("道具袋がいっぱいだ。");
                }

                case ShopActionKind.ServeCustomer:
                {
                    var record = simulation.Serve(shop, shop.AtCounter());
                    return record != null
                        ? ShopActionResult.Ok($"{record.Price}Gで売れた。")
                        : ShopActionResult.Failed("今は会計できない。");
                }

                case ShopActionKind.OpenShop:
                    simulation.Open(shop);
                    state.Mode = GameMode.HomeShopOpen;
                    return ShopActionResult.Ok("開店した。");

                case ShopActionKind.CloseShop:
                    simulation.BeginClosing(shop);
                    return ShopActionResult.Ok("札を裏返した。店内の客が帰ったら閉店だ。");

                case ShopActionKind.LeaveForDungeon:
                    return state.ExpeditionUsedToday
                        ? ShopActionResult.Failed("今日はもう出発できない。")
                        : ShopActionResult.Ok("ダンジョンへ向かう。");

                default:
                    return ShopActionResult.Failed("ここには何もない。");
            }
        }
    }
}
