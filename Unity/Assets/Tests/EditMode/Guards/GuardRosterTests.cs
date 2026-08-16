using System.Linq;
using Merchan.Domain;
using NUnit.Framework;

namespace Merchan.Domain.Tests
{
    /// <summary>
    /// Escort contracts. The fee is paid when the contract is signed, so choosing
    /// an escort is a decision made while the money is still in hand — and a
    /// wounded escort costs days, which money cannot buy back.
    /// </summary>
    public sealed class GuardRosterTests
    {
        private GameState state;
        private GuardRoster roster;

        [SetUp]
        public void SetUp()
        {
            var ledger = new ItemLedger();
            state = new GameState(ledger, new InventoryState()) { Gold = 500 };
            roster = new GuardRoster(state, StarterContent.Guards());
        }

        private GuardRecord Rolf => roster.Record("rolf");

        private GuardRecord Mina => roster.Record("mina");

        [Test]
        public void OnlyTheFirstEscortIsAvailableToBeginWith()
        {
            Assert.That(Rolf.Unlocked, Is.True);
            Assert.That(Mina.Unlocked, Is.False);
            Assert.That(roster.CanHire("mina"), Is.False, "escorts are met, not bought off a list");
        }

        [Test]
        public void HiringTakesTheFeeUpFront()
        {
            var fee = roster.FeeFor("rolf");

            Assert.That(roster.TryHire("rolf"), Is.True);

            Assert.That(state.Gold, Is.EqualTo(500 - fee));
            Assert.That(state.HiredGuardId, Is.EqualTo("rolf"));
        }

        [Test]
        public void CancellingRefundsTheFee()
        {
            roster.TryHire("rolf");

            roster.CancelContract();

            Assert.That(state.Gold, Is.EqualTo(500));
            Assert.That(state.HiredGuardId, Is.Null);
        }

        [Test]
        public void SwitchingEscortsDoesNotChargeTwice()
        {
            roster.Unlock("mina");
            roster.TryHire("rolf");

            Assert.That(roster.TryHire("mina"), Is.True);

            Assert.That(state.Gold, Is.EqualTo(500 - roster.FeeFor("mina")));
            Assert.That(state.HiredGuardId, Is.EqualTo("mina"));
        }

        [Test]
        public void AnEscortTooExpensiveToAffordCannotBeHired()
        {
            state.Gold = 10;

            Assert.That(roster.CanHire("rolf"), Is.False);
            Assert.That(roster.TryHire("rolf"), Is.False);
            Assert.That(state.HiredGuardId, Is.Null);
        }

        [Test]
        public void GoodwillDiscountsTheFeeButOnlySoFar()
        {
            var full = roster.FeeFor("rolf");

            Rolf.Relation = 5;
            Assert.That(roster.FeeFor("rolf"), Is.LessThan(full));

            Rolf.Relation = 100;
            Assert.That(roster.FeeFor("rolf"), Is.EqualTo((int)(StarterContent.Guards()[0].BaseFee * 0.8)),
                "the discount is capped at a fifth");
        }

        [Test]
        public void AWoundedEscortCannotWorkForSeveralDays()
        {
            roster.RecordInjury("rolf");

            Assert.That(roster.CanHire("rolf"), Is.False);
            Assert.That(Rolf.IsInjuredOn(state.Day), Is.True);

            state.Day += 3;
            Assert.That(roster.CanHire("rolf"), Is.True);
        }

        [Test]
        public void ComingHomeTogetherEarnsGoodwillAndExperience()
        {
            roster.TryHire("rolf");

            roster.SettleExpedition(escortSurvived: true, floorsReached: 1);

            Assert.That(Rolf.Relation, Is.EqualTo(1));
            Assert.That(Rolf.Experience, Is.EqualTo(1));
            Assert.That(state.HiredGuardId, Is.Null, "the contract is spent either way");
        }

        [Test]
        public void LosingTheEscortEarnsNoGoodwill()
        {
            roster.TryHire("rolf");

            roster.SettleExpedition(escortSurvived: false, floorsReached: 2);

            Assert.That(Rolf.Relation, Is.EqualTo(0));
            Assert.That(Rolf.Experience, Is.EqualTo(2), "they still did the work");
        }

        [Test]
        public void ExperienceRaisesStaminaRatherThanDamage()
        {
            var definition = roster.Definition("rolf");
            var atFirst = GuardRoster.MaxHpFor(Rolf, definition);

            Rolf.Experience = 7;
            Rolf.Level = 3;
            roster.TryHire("rolf");

            Assert.That(GuardRoster.MaxHpFor(Rolf, definition), Is.GreaterThan(atFirst));
            Assert.That(roster.Muster(new GridPos(0, 0)).Damage, Is.EqualTo(definition.Damage),
                "growth must not turn the escort into a different job");
        }

        [Test]
        public void MusteringWithoutAContractProducesNoEscort()
        {
            Assert.That(roster.Muster(new GridPos(1, 1)), Is.Null);
        }

        [Test]
        public void TheRosterSurvivesASaveAndReload()
        {
            roster.Unlock("mina");
            Rolf.Relation = 12;
            Rolf.Experience = 4;
            Rolf.Level = 2;
            roster.RecordInjury("mina");
            roster.TryHire("rolf");

            var save = SaveMapper.Capture(state, roster);
            var restoredState = SaveMapper.Restore(save);
            var restored = new GuardRoster(restoredState, StarterContent.Guards(), SaveMapper.RestoreGuards(save));

            Assert.That(restoredState.HiredGuardId, Is.EqualTo("rolf"));
            Assert.That(restoredState.HiredGuardFee, Is.EqualTo(state.HiredGuardFee));
            Assert.That(restored.Record("rolf").Relation, Is.EqualTo(12));
            Assert.That(restored.Record("rolf").Level, Is.EqualTo(2));
            Assert.That(restored.Record("mina").Unlocked, Is.True);
            Assert.That(restored.Record("mina").InjuredUntilDay, Is.EqualTo(state.Day + 3));
        }

        [Test]
        public void ARosterFromAnOlderSaveGainsAnyNewlyDefinedEscorts()
        {
            var partial = new[] { new GuardRecord("rolf", unlocked: true) { Relation = 9 } };

            var restored = new GuardRoster(state, StarterContent.Guards(), partial);

            Assert.That(restored.Record("rolf").Relation, Is.EqualTo(9));
            Assert.That(restored.Record("mina"), Is.Not.Null, "a guard added since the save must still appear");
        }

        [Test]
        public void EveryDefinedEscortHasARecord()
        {
            Assert.That(roster.Records.Select(r => r.GuardId).OrderBy(id => id),
                Is.EqualTo(StarterContent.Guards().Select(g => g.Id).OrderBy(id => id)));
        }
    }
}
