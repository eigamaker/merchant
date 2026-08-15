using UnityEngine;

namespace Merchan.Unity
{
    /// <summary>
    /// Small runtime seam for the generated Craftpix enemy prefabs.
    /// The importer creates states named &lt;action&gt;-&lt;direction&gt; (or
    /// &lt;action&gt;-rowNN for the Glassblower sheets), so gameplay code can select
    /// a complete character animation without ever addressing a loose frame.
    /// </summary>
    public sealed class EnemyActorAnimator : MonoBehaviour
    {
        [SerializeField] private Animator animator;
        [SerializeField] private string defaultState = "idle-down";

        private void Awake()
        {
            if (animator == null)
                animator = GetComponent<Animator>();

            if (animator != null && !string.IsNullOrEmpty(defaultState))
                animator.Play(defaultState, 0, 0f);
        }

        public bool Play(string action, string direction = "down", bool restart = true)
        {
            if (animator == null)
                animator = GetComponent<Animator>();
            if (animator == null)
                return false;

            var stateName = string.IsNullOrEmpty(direction) ? action : $"{action}-{direction}";
            var stateHash = Animator.StringToHash(stateName);
            if (!animator.HasState(0, stateHash))
                return false;

            animator.Play(stateHash, 0, restart ? 0f : Mathf.NegativeInfinity);
            return true;
        }

        public bool PlayRow(string action, int row, bool restart = true)
        {
            return Play(action, $"row{row:00}", restart);
        }
    }
}
