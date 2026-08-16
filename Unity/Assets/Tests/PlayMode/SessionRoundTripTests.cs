using System.Collections;
using System.Linq;
using Merchan.Domain;
using Merchan.Unity;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Merchan.Unity.PlayTests
{
    /// <summary>
    /// The loop closing: shop → dungeon → shop with one world throughout.
    ///
    /// This is the failure the session exists to prevent. Each scene used to build
    /// its own GameState in Awake, so walking out of the shop silently threw away
    /// everything the expedition was for — and nothing in the EditMode suite could
    /// have noticed, because none of it loads a scene.
    /// </summary>
    public sealed class SessionRoundTripTests
    {
        [SetUp]
        public void SetUp()
        {
            // The session survives scene loads on purpose, so it also survives from
            // one test to the next unless it is cleared.
            var existing = Object.FindFirstObjectByType<MerchanSession>();
            if (existing != null)
            {
                existing.DeleteSave();
                Object.DestroyImmediate(existing.gameObject);
            }
        }

        [UnityTest]
        public IEnumerator LeavingTheShopCarriesTheWorldIntoTheDungeon()
        {
            yield return Load(MerchanSession.HomeShopScene);

            var session = MerchanSession.Instance;
            var carried = session.Ledger.InBag().Select(item => item.Uuid).OrderBy(id => id).ToList();
            var gold = session.State.Gold;

            Assert.That(session.DepartForDungeon(), Is.True);
            yield return null;
            yield return null;

            Assert.That(Object.FindFirstObjectByType<DungeonSceneController>(), Is.Not.Null, "the dungeon should have loaded");
            Assert.That(MerchanSession.Instance, Is.SameAs(session), "the session must not be rebuilt");
            Assert.That(session.Ledger.InBag().Select(i => i.Uuid).OrderBy(id => id), Is.EqualTo(carried));
            Assert.That(session.State.ExpeditionUsedToday, Is.True);
            Assert.That(session.State.Gold, Is.LessThanOrEqualTo(gold), "an escort's fee comes out of the purse");
        }

        [UnityTest]
        public IEnumerator AFindMadeUndergroundIsStillThereBackAtTheShop()
        {
            yield return Load(MerchanSession.HomeShopScene);
            var session = MerchanSession.Instance;
            session.DepartForDungeon();
            yield return null;
            yield return null;

            // Stands in for pulling something out of a remnant, which the EditMode
            // suite already covers in full.
            var haul = session.Ledger.Create("blue-gem", session.State.Day, 1, ItemLocation.InPlayerBag());

            session.ReturnToShop(RunOutcome.Returned, escortSurvived: true, floorsReached: 1);
            yield return null;
            yield return null;

            Assert.That(Object.FindFirstObjectByType<HomeShopSceneController>(), Is.Not.Null, "the shop should have loaded");
            Assert.That(session.Ledger.Contains(haul.Uuid), Is.True, "the find came home");
            Assert.That(session.Ledger.Get(haul.Uuid).Location, Is.EqualTo(ItemLocation.InPlayerBag()));
            Assert.That(session.State.Day, Is.EqualTo(1), "walking home does not end the day");
        }

        [UnityTest]
        public IEnumerator TheEscortIsMusteredFromTheContract()
        {
            yield return Load(MerchanSession.HomeShopScene);
            var session = MerchanSession.Instance;

            Assert.That(session.Guards.TryHire("rolf"), Is.True);
            session.DepartForDungeon();
            yield return null;
            yield return null;

            var escorts = Object.FindObjectsByType<GridActorView>(FindObjectsSortMode.None)
                .Count(view => view.gameObject.name == session.Guards.Definition("rolf").Name);

            Assert.That(escorts, Is.EqualTo(1), "the escort under contract should be standing beside the merchant");
        }

        [UnityTest]
        public IEnumerator AnExpeditionSettlesTheContractAndEarnsGoodwill()
        {
            yield return Load(MerchanSession.HomeShopScene);
            var session = MerchanSession.Instance;
            session.Guards.TryHire("rolf");
            session.DepartForDungeon();
            yield return null;

            session.ReturnToShop(RunOutcome.Returned, escortSurvived: true, floorsReached: 2);
            yield return null;

            Assert.That(session.State.HiredGuardId, Is.Null, "the contract is spent");
            Assert.That(session.Guards.Record("rolf").Experience, Is.EqualTo(2));
            Assert.That(session.Guards.Record("rolf").Relation, Is.EqualTo(1));
        }

        [UnityTest]
        public IEnumerator BeingRescuedEndsTheDayAndReportsTheLoss()
        {
            yield return Load(MerchanSession.HomeShopScene);
            var session = MerchanSession.Instance;
            session.DepartForDungeon();
            yield return null;

            session.ReturnToShop(RunOutcome.Rescued, escortSurvived: false, floorsReached: 1);
            yield return null;
            yield return null;

            Assert.That(session.State.Day, Is.EqualTo(2), "there is no opening up after being carried home");
            Assert.That(session.State.Hp, Is.EqualTo(session.State.MaxHp), "and the night restores you");
        }

        [UnityTest]
        public IEnumerator TheWorldSurvivesBeingWrittenToDiskAndReadBack()
        {
            yield return Load(MerchanSession.HomeShopScene);
            var session = MerchanSession.Instance;
            session.Guards.TryHire("rolf");
            var kept = session.Ledger.Create("stone-statue", session.State.Day, 3, ItemLocation.InShopStorage());
            session.State.Gold = 777;
            session.Save();

            Assert.That(session.TryLoad(), Is.True);

            Assert.That(session.State.Gold, Is.EqualTo(777));
            Assert.That(session.Ledger.Get(kept.Uuid)?.Location, Is.EqualTo(ItemLocation.InShopStorage()));
            Assert.That(session.State.HiredGuardId, Is.EqualTo("rolf"));

            session.DeleteSave();
        }

        private static IEnumerator Load(string sceneName)
        {
            yield return SceneManager.LoadSceneAsync(sceneName, LoadSceneMode.Single);
            yield return null;
            yield return null;
        }
    }
}
