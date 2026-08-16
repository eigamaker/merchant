using Merchan.Domain;
using UnityEngine;

namespace Merchan.Unity
{
    /// <summary>
    /// Draws one domain actor. The rules move actors a whole cell at a time; this
    /// slides the sprite between cells so the step reads as movement rather than a
    /// teleport. The domain never waits for it — the turn is already fully
    /// resolved by the time a view starts animating.
    ///
    /// One cell is one Unity unit, so a cell converts to a position by adding half
    /// a unit to centre it.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GridActorView : MonoBehaviour
    {
        private const float StepSeconds = 0.11f;

        private EnemyActorAnimator actorAnimator;
        private SpriteRenderer spriteRenderer;
        private Vector3 from;
        private Vector3 to;
        private float progress = 1f;
        private string facing = "down";

        public static Vector3 ToWorld(GridPos cell) => new Vector3(cell.X + 0.5f, cell.Y + 0.5f, 0f);

        private void Awake()
        {
            actorAnimator = GetComponentInChildren<EnemyActorAnimator>();
            spriteRenderer = GetComponentInChildren<SpriteRenderer>();
        }

        /// <summary>Places the actor without animating. Used when a run starts.</summary>
        public void Snap(GridPos cell)
        {
            from = to = ToWorld(cell);
            progress = 1f;
            transform.position = to;
            UpdateSortingOrder();
        }

        public void StepTo(GridPos cell)
        {
            from = transform.position;
            to = ToWorld(cell);
            progress = 0f;

            var delta = to - from;
            if (delta.sqrMagnitude > 0.001f)
                facing = Mathf.Abs(delta.x) > Mathf.Abs(delta.y)
                    ? delta.x < 0f ? "left" : "right"
                    : delta.y < 0f ? "down" : "up";
        }

        public void Face(Facing value)
        {
            switch (value)
            {
                case Facing.Up: facing = "up"; break;
                case Facing.Down: facing = "down"; break;
                case Facing.Left: facing = "left"; break;
                default: facing = "right"; break;
            }
            Play("idle");
        }

        public void PlayAttack() => Play("attack");

        public void PlayHurt() => Play("hurt");

        private void Play(string action)
        {
            // The generated Craftpix prefabs do not all carry every action, so a
            // missing clip falls back to idle rather than freezing the sprite.
            if (actorAnimator == null) return;
            if (!actorAnimator.Play(action, facing)) actorAnimator.Play("idle", facing, false);
        }

        private void Update()
        {
            if (progress < 1f)
            {
                progress = Mathf.Min(1f, progress + Time.deltaTime / StepSeconds);
                transform.position = Vector3.Lerp(from, to, progress);
                if (progress >= 1f) Play("idle");
                else Play("walk");
                UpdateSortingOrder();
            }
        }

        /// <summary>Whatever stands lower on the screen draws in front, so an actor
        /// never disappears behind one that is further away.</summary>
        private void UpdateSortingOrder()
        {
            if (spriteRenderer != null) spriteRenderer.sortingOrder = 100 - Mathf.RoundToInt(transform.position.y * 4f);
        }

        public bool IsAnimating => progress < 1f;
    }
}
