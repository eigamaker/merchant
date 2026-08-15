using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Tilemaps;

namespace Merchan.Unity
{
    /// <summary>
    /// Minimal playable Unity 2D entry point. It reads the same town layout and
    /// art used by the Phaser edition, so both implementations share source data.
    /// </summary>
    public sealed class MerchanBootstrap : MonoBehaviour
    {
        // Temporary authoring mode: keep the authored collision tilemap in the
        // scene, but do not let it restrict exploration while the map is being
        // reviewed. Re-enable this after walkable areas are finalized.
        private const bool FreeRoamMode = true;
        private const float PlayerRadius = 0.35f;
        private const float MoveSpeed = 5f;

        private TownLayout town;
        private Transform player;
        private EnemyActorAnimator playerAnimator;
        private string playerFacing = "down";
        private string notice;
        private readonly HashSet<KeyCode> heldKeys = new HashSet<KeyCode>();
        private bool interactRequested;
        private TilemapCollider2D townCollision;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void CreateGame()
        {
            if (FindFirstObjectByType<MerchanBootstrap>() == null)
                new GameObject("Merchan Unity Bootstrap").AddComponent<MerchanBootstrap>();
        }

        private void Start()
        {
            var layoutAsset = Resources.Load<TextAsset>("Merchan/Data/townLayout");
            if (layoutAsset == null)
            {
                Debug.LogError("Merchan townLayout.json was not imported. See Unity/README.md.");
                return;
            }

            town = JsonUtility.FromJson<TownLayout>(layoutAsset.text);
            BuildCamera();
            BuildTownBackdrop();
            BuildPlayer();
            BuildHud();
        }

        private void Update()
        {
            if (town == null || player == null)
                return;

            var input = ReadMovement();
            if (input.sqrMagnitude > 1f)
                input.Normalize();

            if (input.sqrMagnitude > 0.001f)
                playerFacing = Mathf.Abs(input.x) > Mathf.Abs(input.y)
                    ? input.x < 0f ? "left" : "right"
                    : input.y < 0f ? "down" : "up";

            var position = (Vector2)player.position;
            position = TryMove(position, new Vector2(input.x, 0f) * MoveSpeed * Time.deltaTime);
            position = TryMove(position, new Vector2(0f, input.y) * MoveSpeed * Time.deltaTime);
            player.position = new Vector3(position.x, position.y, -2f);
            if (playerAnimator != null)
                playerAnimator.Play(input.sqrMagnitude > 0.001f ? "walk" : "idle", playerFacing, false);

            if (interactRequested)
            {
                Interact();
                interactRequested = false;
            }
        }

        private void BuildCamera()
        {
            var camera = Camera.main;
            var cameraObject = camera == null ? new GameObject("Main Camera") : camera.gameObject;
            if (camera == null)
            {
                cameraObject.tag = "MainCamera";
                camera = cameraObject.AddComponent<Camera>();
            }
            camera.orthographic = true;
            camera.orthographicSize = town.height * 0.5f;
            camera.backgroundColor = new Color(0.06f, 0.08f, 0.11f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            cameraObject.transform.position = new Vector3(town.width * 0.5f, town.height * 0.5f, -10f);
        }

        private Vector2 ReadMovement()
        {
            var horizontal = 0f;
            var vertical = 0f;
            if (KeyHeld(KeyCode.A) || KeyHeld(KeyCode.LeftArrow)) horizontal -= 1f;
            if (KeyHeld(KeyCode.D) || KeyHeld(KeyCode.RightArrow)) horizontal += 1f;
            if (KeyHeld(KeyCode.S) || KeyHeld(KeyCode.DownArrow)) vertical -= 1f;
            if (KeyHeld(KeyCode.W) || KeyHeld(KeyCode.UpArrow)) vertical += 1f;
            return new Vector2(horizontal, vertical);
        }

        private bool KeyHeld(KeyCode key) => heldKeys.Contains(key);

        private void BuildTownBackdrop()
        {
            var townGrid = GameObject.Find("TownGrid");
            if (townGrid != null)
            {
                townCollision = townGrid.transform.Find("Collision")?.GetComponent<TilemapCollider2D>();
                if (FreeRoamMode && townCollision != null)
                    townCollision.enabled = false;
                return;
            }

            Debug.LogError("TownGrid is missing. Rebuild Assets/Scenes/TownAuthoring.unity from Merchan/Build Town Tilemap Scene.");
        }

        private void BuildPlayer()
        {
            var playerPrefab = Resources.Load<GameObject>("Merchan/Prefabs/Player/Craftpix/MerchantProtagonist");
            if (playerPrefab != null)
            {
                var merchantObject = Instantiate(playerPrefab);
                merchantObject.name = "Player";
                merchantObject.transform.position = ToWorld(town.spawn.x, town.spawn.y, -2f);
                merchantObject.transform.SetPositionAndRotation(merchantObject.transform.position, Quaternion.identity);
                var playerRenderer = merchantObject.GetComponent<SpriteRenderer>();
                if (playerRenderer != null)
                    playerRenderer.sortingOrder = 10;
                playerAnimator = merchantObject.GetComponent<EnemyActorAnimator>();
                player = merchantObject.transform;
                return;
            }

            // Keep the legacy fallback for projects that have not regenerated
            // the Craftpix player resource prefab yet.
            var texture = Resources.Load<Texture2D>("Merchan/assets/actors/player");
            if (texture == null)
            {
                Debug.LogError("Player art is missing at Assets/Resources/Merchan/assets/actors/player.png.");
                return;
            }

            var playerObject = new GameObject("Player");
            var renderer = playerObject.AddComponent<SpriteRenderer>();
            renderer.sprite = Sprite.Create(texture, new Rect(0, 0, 32, 32), new Vector2(0.5f, 0.15f), town.tile);
            renderer.sortingOrder = 10;
            player = playerObject.transform;
            player.position = ToWorld(town.spawn.x, town.spawn.y, -2f);
        }

        private void BuildHud()
        {
            notice = "Click the Game view, then move: WASD / Arrow Keys  |  Interact: E or Space";
        }

        private Vector2 TryMove(Vector2 from, Vector2 delta)
        {
            var candidate = from + delta;
            return IsWalkable(candidate) ? candidate : from;
        }

        private bool IsWalkable(Vector2 position)
        {
            if (position.x - PlayerRadius < 0f || position.y - PlayerRadius < 0f ||
                position.x + PlayerRadius >= town.width || position.y + PlayerRadius >= town.height)
                return false;

            if (FreeRoamMode)
                return true;

            if (townCollision != null)
                return Physics2D.OverlapCircle(position, PlayerRadius) == null;

            var minX = Mathf.FloorToInt(position.x - PlayerRadius);
            var maxX = Mathf.FloorToInt(position.x + PlayerRadius);
            var minY = Mathf.FloorToInt(position.y - PlayerRadius);
            var maxY = Mathf.FloorToInt(position.y + PlayerRadius);
            for (var y = minY; y <= maxY; y++)
            for (var x = minX; x <= maxX; x++)
            {
                var sourceY = town.height - 1 - y;
                if (town.collision[sourceY][x] == '#')
                    return false;
            }
            return true;
        }

        private void Interact()
        {
            var closest = town.buildings
                .Select(building => new { building, distance = Vector2.Distance(player.position, ToWorld(building.entrance.x, building.entrance.y, 0f)) })
                .Where(entry => entry.distance <= 1.25f)
                .OrderBy(entry => entry.distance)
                .FirstOrDefault();

            notice = closest == null
                ? "Nothing is close enough to interact with."
                : $"{closest.building.name} ({closest.building.kind}) — Unity interaction hook reached.";
        }

        private void OnGUI()
        {
            // IMGUI events are available with either Unity input backend. This
            // fallback lets the starter scene work even when a project uses the
            // newer Input System only (where Input.GetKey is disabled).
            var currentEvent = Event.current;
            if (currentEvent != null)
            {
                if (currentEvent.type == EventType.KeyDown)
                {
                    heldKeys.Add(currentEvent.keyCode);
                    if (currentEvent.keyCode == KeyCode.E || currentEvent.keyCode == KeyCode.Space)
                        interactRequested = true;
                }
                else if (currentEvent.type == EventType.KeyUp)
                {
                    heldKeys.Remove(currentEvent.keyCode);
                }
            }

            if (string.IsNullOrEmpty(notice))
                return;

            var style = new GUIStyle(GUI.skin.label)
            {
                fontSize = 20,
                normal = { textColor = Color.white },
                wordWrap = true
            };
            GUI.Box(new Rect(12f, 12f, 700f, 64f), GUIContent.none);
            GUI.Label(new Rect(24f, 22f, 676f, 48f), notice, style);
        }

        private void OnApplicationFocus(bool hasFocus)
        {
            if (!hasFocus)
                heldKeys.Clear();
        }

        private Vector3 ToWorld(int sourceX, int sourceY, float z)
        {
            return new Vector3(sourceX + 0.5f, town.height - sourceY - 0.5f, z);
        }
    }
}
