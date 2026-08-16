using System.Collections;
using Merchan.Domain;
using Merchan.Unity;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Merchan.Unity.PlayTests
{
    /// <summary>
    /// The authored shop has to pass its own validator. Every way of misbuilding
    /// the room — a shelf nobody can reach, a queue that does not end at the
    /// counter — is logged as an error by the controller, and the test framework
    /// fails on logged errors, so simply loading the scene is the check.
    /// </summary>
    public sealed class HomeShopSceneTests
    {
        [UnityTest]
        public IEnumerator TheAuthoredShopPassesItsOwnValidator()
        {
            yield return LoadShop();

            Assert.That(Object.FindFirstObjectByType<HomeShopSceneController>(), Is.Not.Null);
        }

        [UnityTest]
        public IEnumerator TheFixturesInTheSceneBuildAWorkingLayout()
        {
            yield return LoadShop();

            var root = GameObject.Find("HomeShop");
            Assert.That(root, Is.Not.Null);

            var layout = ShopLayoutBuilder.Build(root.transform, 14, 10, out var problems);

            Assert.That(layout, Is.Not.Null, string.Join("; ", problems));
            Assert.That(problems, Is.Empty, string.Join("; ", problems));
            Assert.That(layout.Shelves.Count, Is.EqualTo(2));
            Assert.That(layout.QueueCells.Count, Is.EqualTo(3));
        }

        [UnityTest]
        public IEnumerator EveryFixtureCanBeWalkedToFromTheDoor()
        {
            yield return LoadShop();

            var layout = ShopLayoutBuilder.Build(GameObject.Find("HomeShop").transform, 14, 10, out _);
            var reachable = layout.Floor.ReachableFrom(layout.CustomerEntrance);

            Assert.That(reachable, Contains.Item(layout.ClerkCell), "the merchant cannot get behind the counter");
            Assert.That(reachable, Contains.Item(layout.StorageCell));
            Assert.That(reachable, Contains.Item(layout.DungeonExit));
            foreach (var shelf in layout.Shelves)
                Assert.That(reachable, Contains.Item(shelf.AccessCell), $"shelf '{shelf.Id}' is stranded");
        }

        [UnityTest]
        public IEnumerator DayOneStartsWithStockToPutOutButEmptyShelves()
        {
            yield return LoadShop();

            var session = MerchanSession.Instance;

            Assert.That(session.Ledger.InShopStorage(), Is.Not.Empty, "there should be something to open with");
            Assert.That(session.Ledger.At(ItemPlace.ShelfSlot), Is.Empty,
                "stocking the shelves is the player's job, not the scene's");
        }

        private static IEnumerator LoadShop()
        {
            yield return SceneManager.LoadSceneAsync("HomeShop", LoadSceneMode.Single);
            yield return null;
            yield return null;
        }
    }
}
