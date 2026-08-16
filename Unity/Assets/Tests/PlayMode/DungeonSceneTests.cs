using System.Collections;
using Merchan.Unity;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Merchan.Unity.PlayTests
{
    /// <summary>
    /// Proves the dungeon scene actually starts. The EditMode suite covers the
    /// rules exhaustively but never touches a MonoBehaviour, so a missing prefab
    /// reference or a null in Awake would sail past it and only surface when
    /// somebody pressed Play.
    ///
    /// The test framework fails on any logged error, which is most of the point:
    /// these tests assert that the scene comes up clean.
    /// </summary>
    public sealed class DungeonSceneTests
    {
        [UnityTest]
        public IEnumerator TheDungeonSceneComesUpCleanly()
        {
            yield return LoadDungeon();

            var controller = Object.FindFirstObjectByType<DungeonSceneController>();
            Assert.That(controller, Is.Not.Null, "the scene should hold the controller");
        }

        [UnityTest]
        public IEnumerator TheMerchantAndTheEscortAreBothOnTheFloor()
        {
            yield return LoadDungeon();

            var player = GameObject.Find("Player");
            Assert.That(player, Is.Not.Null, "the merchant was never spawned");
            Assert.That(player.GetComponent<GridActorView>(), Is.Not.Null);

            var actors = Object.FindObjectsByType<GridActorView>(FindObjectsSortMode.None);
            Assert.That(actors.Length, Is.GreaterThan(1), "the escort should be spawned beside the merchant");
        }

        [UnityTest]
        public IEnumerator ActorsUseTheImportedArtRatherThanPlaceholders()
        {
            yield return LoadDungeon();

            // The controller falls back to a flat coloured square when a prefab
            // reference is missing. An Animator means the real Craftpix prefab was
            // wired up by Merchan/Build Dungeon Scene.
            var player = GameObject.Find("Player");
            Assert.That(player.GetComponentInChildren<Animator>(), Is.Not.Null,
                "the merchant is a placeholder square; re-run Merchan/Build Dungeon Scene");
        }

        [UnityTest]
        public IEnumerator TheFloorIsDrawnAroundTheEntrance()
        {
            yield return LoadDungeon();

            var floor = GameObject.Find("Floor");
            Assert.That(floor, Is.Not.Null);
            Assert.That(floor.transform.childCount, Is.GreaterThan(100), "the authored floor should be a full grid of cells");
        }

        private static IEnumerator LoadDungeon()
        {
            yield return SceneManager.LoadSceneAsync("Dungeon", LoadSceneMode.Single);
            // One frame for Awake and Start, a second for the first Update pass.
            yield return null;
            yield return null;
        }
    }
}
