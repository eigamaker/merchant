using System.Collections.Generic;

namespace Merchan.Domain
{
    /// <summary>
    /// What the merchant knows about one escort, across expeditions. Separate from
    /// <see cref="GuardActor"/>, which only exists while underground.
    /// </summary>
    public sealed class GuardRecord
    {
        public GuardRecord(string guardId, bool unlocked = false)
        {
            GuardId = guardId;
            Unlocked = unlocked;
            Level = 1;
        }

        public string GuardId { get; }

        /// <summary>Whether they can be hired at all. Escorts are met through the
        /// story rather than bought off a list.</summary>
        public bool Unlocked { get; internal set; }

        /// <summary>Goodwill, 0–100. Discounts the fee.</summary>
        public int Relation { get; internal set; }

        public int Experience { get; internal set; }

        public int Level { get; internal set; }

        /// <summary>The first day they can work again. A wounded escort is the real
        /// cost of a bad expedition — the money comes back, the escort does not.</summary>
        public int InjuredUntilDay { get; internal set; }

        public bool IsInjuredOn(int day) => InjuredUntilDay > day;
    }

    /// <summary>
    /// Hiring, fees, injury and growth. The contract is paid up front and refunded
    /// if cancelled, so committing to an escort is a real decision at the point the
    /// merchant still has the gold in hand.
    /// </summary>
    public sealed class GuardRoster
    {
        private const int InjuryDays = 3;

        private readonly Dictionary<string, GuardDefinition> definitions = new Dictionary<string, GuardDefinition>();
        private readonly List<GuardRecord> records = new List<GuardRecord>();
        private readonly GameState state;

        public GuardRoster(GameState state, IEnumerable<GuardDefinition> guards, IEnumerable<GuardRecord> existing = null)
        {
            this.state = state;
            foreach (var guard in guards) definitions[guard.Id] = guard;

            if (existing != null)
            {
                foreach (var record in existing)
                    if (definitions.ContainsKey(record.GuardId))
                        records.Add(record);
            }

            // The first escort is available from the start; the rest are met later.
            foreach (var id in definitions.Keys)
                if (Record(id) == null)
                    records.Add(new GuardRecord(id, unlocked: records.Count == 0));
        }

        public IReadOnlyList<GuardRecord> Records => records;

        public IEnumerable<GuardDefinition> Definitions => definitions.Values;

        /// <summary>Null-tolerant: "no escort under contract" is an ordinary state,
        /// not a mistake, so callers should not have to guard every lookup.</summary>
        public GuardDefinition Definition(string guardId)
        {
            if (guardId == null) return null;
            definitions.TryGetValue(guardId, out var definition);
            return definition;
        }

        public GuardRecord Record(string guardId)
        {
            if (guardId == null) return null;
            foreach (var record in records)
                if (record.GuardId == guardId)
                    return record;
            return null;
        }

        public void Unlock(string guardId)
        {
            var record = Record(guardId);
            if (record != null) record.Unlocked = true;
        }

        /// <summary>
        /// Goodwill knocks up to a fifth off the fee. Working with the same escort
        /// repeatedly should be worth something beyond familiarity.
        /// </summary>
        public int FeeFor(string guardId)
        {
            var definition = Definition(guardId);
            var record = Record(guardId);
            if (definition == null || record == null) return 0;

            var discount = record.Relation * 0.02;
            if (discount > 0.2) discount = 0.2;

            var fee = (int)(definition.BaseFee * (1.0 - discount));
            return fee < 1 ? 1 : fee;
        }

        public bool CanHire(string guardId)
        {
            var record = Record(guardId);
            if (record == null || !record.Unlocked) return false;
            if (record.IsInjuredOn(state.Day)) return false;

            // Cancelling the current contract refunds its fee, so that money counts
            // towards affording a different escort.
            return state.Gold + state.HiredGuardFee >= FeeFor(guardId);
        }

        public bool TryHire(string guardId)
        {
            if (!CanHire(guardId)) return false;

            CancelContract();
            state.Gold -= FeeFor(guardId);
            state.HiredGuardId = guardId;
            state.HiredGuardFee = FeeFor(guardId);
            return true;
        }

        public void CancelContract()
        {
            if (state.HiredGuardId == null) return;

            state.Gold += state.HiredGuardFee;
            state.HiredGuardId = null;
            state.HiredGuardFee = 0;
        }

        /// <summary>Builds the escort that walks into the dungeon, at the strength
        /// their level has earned.</summary>
        public GuardActor Muster(GridPos cell)
        {
            var definition = Definition(state.HiredGuardId);
            var record = Record(state.HiredGuardId);
            if (definition == null || record == null) return null;

            return new GuardActor(definition, cell, MaxHpFor(record, definition), definition.Damage);
        }

        /// <summary>Two extra points of stamina a level. Growth shows up as lasting
        /// longer rather than hitting harder, so the escort's job stays the same.</summary>
        public static int MaxHpFor(GuardRecord record, GuardDefinition definition)
        {
            return definition.BaseMaxHp + (record.Level - 1) * 2;
        }

        /// <summary>Called when the escort is carried out wounded.</summary>
        public void RecordInjury(string guardId)
        {
            var record = Record(guardId);
            if (record != null) record.InjuredUntilDay = state.Day + InjuryDays;
        }

        /// <summary>
        /// Settles up after an expedition. The contract is spent either way — the
        /// escort worked — and coming back with them intact earns goodwill.
        /// </summary>
        public void SettleExpedition(bool escortSurvived, int floorsReached)
        {
            var record = Record(state.HiredGuardId);
            state.HiredGuardId = null;
            state.HiredGuardFee = 0;
            if (record == null) return;

            record.Experience += floorsReached < 1 ? 1 : floorsReached;
            record.Level = record.Experience >= 7 ? 3 : record.Experience >= 3 ? 2 : 1;
            if (escortSurvived && record.Relation < 100) record.Relation++;
        }
    }
}
