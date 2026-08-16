using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// Decides what the merchant's keypress means here, and carries it out.
    ///
    /// There is no shared action menu. `E` resolves against the cell in front
    /// first and the cell underfoot second; within a cell the order is
    /// unsearched remnant, chest, floor item, stairs, exit. A chooser only
    /// appears when one cell genuinely offers more than one thing.
    ///
    /// Whether a command consumed a turn is decided here and nowhere else. Facing,
    /// quick-slot changes and refused actions all leave the world untouched.
    /// </summary>
    public sealed class PlayerActionResolver
    {
        /// <summary>Turns before the merchant can shove again.</summary>
        public const int ShoveCooldownTurns = 2;

        /// <summary>Deliberately low: enough to unbalance the weakest things down
        /// here, not enough to make shoving a substitute for an escort.</summary>
        public const int PlayerPushPower = 1;

        private readonly GameState state;
        private readonly ItemLedger ledger;
        private readonly InventoryService inventory;
        private readonly QuickSlotService quickSlots;
        private readonly IItemCatalog catalog;
        private readonly LootService loot;

        public PlayerActionResolver(
            GameState state,
            ItemLedger ledger,
            InventoryService inventory,
            QuickSlotService quickSlots,
            IItemCatalog catalog,
            LootService loot)
        {
            this.state = state;
            this.ledger = ledger;
            this.inventory = inventory;
            this.quickSlots = quickSlots;
            this.catalog = catalog;
            this.loot = loot;
        }

        /// <summary>
        /// Everything `E` could do, best first. The scene layer shows the first
        /// entry's label beside the key, and only offers a choice when two or more
        /// share the same cell.
        /// </summary>
        public IReadOnlyList<ContextAction> ContextActions(DungeonRunState run)
        {
            var actions = new List<ContextAction>();
            var front = run.Player.Position + run.Player.Facing.ToStep();

            if (run.Map.CanTraverse(run.Player.Position, front) || run.ContainerAt(front) != null)
                CollectAt(run, front, actions);
            CollectAt(run, run.Player.Position, actions);

            return actions;
        }

        private void CollectAt(DungeonRunState run, GridPos cell, List<ContextAction> actions)
        {
            var container = run.ContainerAt(cell);
            if (container != null)
            {
                if (!container.Searched)
                {
                    actions.Add(new ContextAction(
                        container.Kind == ContainerKind.Remnant ? ContextActionKind.SearchRemnant : ContextActionKind.OpenChest,
                        cell,
                        container.Kind == ContainerKind.Remnant ? $"{container.Name}の遺体を探る" : $"{container.Name}を開ける",
                        container.Id));
                }
                else
                {
                    foreach (var item in loot.Contents(container))
                        actions.Add(new ContextAction(ContextActionKind.TakeFromContainer, cell, $"{DisplayName(item)}を取る", container.Id, item.Uuid));
                }
            }

            foreach (var item in ledger.OnGroundAt(cell))
                actions.Add(new ContextAction(ContextActionKind.PickUpGround, cell, $"{DisplayName(item)}を拾う", null, item.Uuid));

            if (cell == run.Map.Stairs)
                actions.Add(new ContextAction(ContextActionKind.Descend, cell, "階段を下りる"));

            if (cell == run.Map.Entrance)
                actions.Add(new ContextAction(ContextActionKind.LeaveDungeon, cell, "店へ帰る"));
        }

        private string DisplayName(ItemInstance item)
        {
            return catalog.TryGet(item.DefinitionId, out var definition) ? definition.NameFor(item.Knowledge) : item.DefinitionId;
        }

        public TurnResult Execute(DungeonRunState run, DungeonCommand command)
        {
            switch (command.Kind)
            {
                case DungeonCommandKind.Face: return Face(run, command.Direction);
                case DungeonCommandKind.Move: return Move(run, command.Direction);
                case DungeonCommandKind.Wait: return TurnResult.Consumed(new[] { DungeonEvent.Message("息をひそめて待つ。") });
                case DungeonCommandKind.Shove: return Shove(run);
                case DungeonCommandKind.UseHeld: return UseHeld(run);
                case DungeonCommandKind.UseQuickConsumable: return UseQuickConsumable(run);
                case DungeonCommandKind.Context: return Context(run, command);
                default: return TurnResult.Refused("その操作はここでは使えない。");
            }
        }

        private static TurnResult Face(DungeonRunState run, GridPos direction)
        {
            run.Player.Facing = FacingExtensions.FromStep(direction, run.Player.Facing);
            return TurnResult.Free(new DungeonEvent[0]);
        }

        private TurnResult Move(DungeonRunState run, GridPos direction)
        {
            // Moving always aims the merchant, even when the step itself fails.
            // Bumping a wall should still leave them looking at what they bumped.
            run.Player.Facing = FacingExtensions.FromStep(direction, run.Player.Facing);

            var destination = run.Player.Position + direction;
            var enemy = run.EnemyAt(destination);
            if (enemy != null) return TurnResult.Refused($"{enemy.Name}が進路を塞いでいる。");
            if (run.Guard != null && run.Guard.Position == destination) return TurnResult.Refused("護衛がいる。別の方向へ進もう。");
            if (!run.Map.CanTraverse(run.Player.Position, destination)) return TurnResult.Refused("壁が行く手を阻んでいる。");

            var from = run.Player.Position;
            run.Player.Position = destination;

            var events = new List<DungeonEvent> { DungeonEvent.Move(PlayerActor.ActorId, from, destination) };
            SpringTrap(run, events);
            return TurnResult.Consumed(events);
        }

        private void SpringTrap(DungeonRunState run, List<DungeonEvent> events)
        {
            if (!run.Traps.Remove(run.Player.Position)) return;

            const int trapDamage = 2;
            state.Hp -= trapDamage;
            events.Add(DungeonEvent.TrapSprung(run.Player.Position, trapDamage));
            if (state.Hp > 0) return;

            state.Hp = 0;
            run.Outcome = RunOutcome.Rescued;
            events.Add(DungeonEvent.Rescued());
        }

        private static TurnResult Shove(DungeonRunState run)
        {
            if (!run.CanShove) return TurnResult.Refused($"息を整えるまで、あと{run.ShoveReadyOnTurn - run.Turn}ターン必要だ。");

            var direction = run.Player.Facing.ToStep();
            var target = run.Player.Position + direction;
            var enemy = run.EnemyAt(target);
            if (enemy == null) return TurnResult.Refused("正面に押し返せる敵はいない。");

            run.ShoveReadyOnTurn = run.Turn + ShoveCooldownTurns + 1;

            if (PlayerPushPower < enemy.Definition.PushResistance)
                return TurnResult.Consumed(new[] { DungeonEvent.ShoveFailed(PlayerActor.ActorId, enemy.Id), DungeonEvent.Message($"{enemy.Name}はびくともしない。") });

            var destination = enemy.Position + direction;
            if (!run.CanStep(enemy.Position, destination))
                return TurnResult.Consumed(new[] { DungeonEvent.ShoveFailed(PlayerActor.ActorId, enemy.Id), DungeonEvent.Message($"{enemy.Name}の後ろが塞がっている。") });

            var from = enemy.Position;
            enemy.Position = destination;
            enemy.StaggerTurns = enemy.StaggerTurns < 1 ? 1 : enemy.StaggerTurns;
            return TurnResult.Consumed(new[] { DungeonEvent.Shove(PlayerActor.ActorId, enemy.Id, from, destination) });
        }

        private TurnResult UseHeld(DungeonRunState run)
        {
            var held = quickSlots.Held();
            if (held == null) return TurnResult.Refused("素手では戦えない。武器を手に持とう。");
            if (!catalog.TryGet(held.DefinitionId, out var definition)) return TurnResult.Refused("それは使えない。");
            if (!definition.IsWeapon) return TurnResult.Refused($"{definition.NameFor(held.Knowledge)}では攻撃できない。");

            var target = run.Player.Position + run.Player.Facing.ToStep();
            var enemy = run.EnemyAt(target);
            if (enemy == null) return TurnResult.Refused("正面に敵はいない。");

            enemy.Hp -= definition.Power;
            var events = new List<DungeonEvent> { DungeonEvent.Attack(PlayerActor.ActorId, enemy.Id, definition.Power) };
            if (!enemy.IsAlive) loot.DefeatEnemy(run, enemy, events);
            return TurnResult.Consumed(events);
        }

        private TurnResult UseQuickConsumable(DungeonRunState run)
        {
            var item = quickSlots.QuickConsumable();
            if (item == null) return TurnResult.Refused("消耗品が設定されていない。");
            if (!catalog.TryGet(item.DefinitionId, out var definition)) return TurnResult.Refused("それは使えない。");

            var events = new List<DungeonEvent>();
            switch (definition.Effect)
            {
                case ConsumableEffect.Heal:
                    if (state.Hp >= state.MaxHp) return TurnResult.Refused("今は必要ない。");
                    state.Hp = System.Math.Min(state.MaxHp, state.Hp + definition.EffectAmount);
                    events.Add(DungeonEvent.Message($"{definition.NameFor(item.Knowledge)}を使った。"));
                    break;

                case ConsumableEffect.Smoke:
                    foreach (var enemy in run.Enemies)
                    {
                        // They keep hunting the cell the merchant is leaving, rather
                        // than losing the trail entirely.
                        enemy.Target = run.Player.Position;
                        enemy.State = EnemyState.Search;
                        enemy.BlindTurns = definition.EffectAmount;
                    }
                    events.Add(DungeonEvent.Message("煙が広がり、追跡が途切れた。"));
                    break;

                case ConsumableEffect.ReturnHome:
                    run.Outcome = RunOutcome.Returned;
                    events.Add(DungeonEvent.LeftDungeon());
                    break;

                default:
                    return TurnResult.Refused("ここでは効果がない。");
            }

            inventory.TryConsume(item.Uuid);
            return TurnResult.Consumed(events);
        }

        private TurnResult Context(DungeonRunState run, DungeonCommand command)
        {
            var candidates = ContextActions(run);
            if (candidates.Count == 0) return TurnResult.Refused("ここには調べるものがない。");

            var chosen = Choose(candidates, command);
            if (chosen == null) return TurnResult.Refused("その対象は見当たらない。");

            switch (chosen.Kind)
            {
                case ContextActionKind.SearchRemnant:
                case ContextActionKind.OpenChest:
                {
                    var container = run.ContainerById(chosen.TargetId);
                    if (container == null) return TurnResult.Refused("その対象は見当たらない。");
                    var events = new List<DungeonEvent>();
                    loot.Search(container, events);
                    return TurnResult.Consumed(events);
                }

                case ContextActionKind.TakeFromContainer:
                {
                    var container = run.ContainerById(chosen.TargetId);
                    var events = new List<DungeonEvent>();
                    if (container == null || !loot.TryTake(container, chosen.ItemUuid, events))
                        return TurnResult.Refused("道具袋がいっぱいだ。");
                    return TurnResult.Consumed(events);
                }

                case ContextActionKind.PickUpGround:
                {
                    var result = inventory.TryPickUp(chosen.ItemUuid);
                    if (!result.Success) return TurnResult.Refused("道具袋がいっぱいだ。");
                    return TurnResult.Consumed(new[] { DungeonEvent.ItemTaken(result.ResultUuid) });
                }

                case ContextActionKind.Descend:
                    return TurnResult.Consumed(new[] { DungeonEvent.Message("さらに下へ続いている。") });

                case ContextActionKind.LeaveDungeon:
                    run.Outcome = RunOutcome.Returned;
                    return TurnResult.Consumed(new[] { DungeonEvent.LeftDungeon() });

                default:
                    return TurnResult.Refused("ここには調べるものがない。");
            }
        }

        private static ContextAction Choose(IReadOnlyList<ContextAction> candidates, DungeonCommand command)
        {
            if (command.TargetId == null && command.ItemUuid == null) return candidates[0];

            foreach (var candidate in candidates)
            {
                if (command.ItemUuid != null && candidate.ItemUuid != command.ItemUuid) continue;
                if (command.TargetId != null && candidate.TargetId != command.TargetId) continue;
                return candidate;
            }
            return null;
        }
    }
}
