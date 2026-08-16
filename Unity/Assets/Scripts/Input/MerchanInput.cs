using System;
using System.Collections.Generic;
using Merchan.Domain;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Merchan.Unity
{
    /// <summary>
    /// The dungeon control scheme, built in code rather than as an .inputactions
    /// asset. An asset would have to be authored by hand and regenerated whenever
    /// a binding changes; a code-built map is one file, is diffable, and still
    /// supports interactive rebinding and persisted overrides.
    ///
    /// There is no shared action menu: every ordinary action has its own key, and
    /// the prompt shows whichever key is currently bound to it.
    /// </summary>
    public sealed class MerchanInput : IDisposable
    {
        private const string OverridesKey = "merchan.bindings";

        /// <summary>How long a held direction waits before it starts repeating, and
        /// how fast it repeats after that. Slow enough that a tap is one step.</summary>
        private const float RepeatDelay = 0.32f;
        private const float RepeatInterval = 0.11f;

        private readonly InputActionMap map;
        private readonly InputAction move;
        private readonly Queue<DungeonCommand> pending = new Queue<DungeonCommand>();

        private Vector2 lastDirection;
        private float repeatAt;

        public MerchanInput()
        {
            map = new InputActionMap("Dungeon");

            move = map.AddAction("Move", InputActionType.Value);
            move.AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/w")
                .With("Down", "<Keyboard>/s")
                .With("Left", "<Keyboard>/a")
                .With("Right", "<Keyboard>/d");
            move.AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/upArrow")
                .With("Down", "<Keyboard>/downArrow")
                .With("Left", "<Keyboard>/leftArrow")
                .With("Right", "<Keyboard>/rightArrow");
            move.AddCompositeBinding("2DVector")
                .With("Up", "<Gamepad>/dpad/up")
                .With("Down", "<Gamepad>/dpad/down")
                .With("Left", "<Gamepad>/dpad/left")
                .With("Right", "<Gamepad>/dpad/right");

            Context = Button("Context", "<Keyboard>/e", "<Gamepad>/buttonSouth");
            Shove = Button("Shove", "<Keyboard>/r", "<Gamepad>/buttonWest");
            UseHeld = Button("UseHeld", "<Keyboard>/f", "<Gamepad>/buttonNorth");
            QuickConsumable = Button("QuickConsumable", "<Keyboard>/c", "<Gamepad>/buttonEast");
            Wait = Button("Wait", "<Keyboard>/space", "<Gamepad>/leftStickPress");
            Bag = Button("Bag", "<Keyboard>/enter", "<Gamepad>/start");
            Cancel = Button("Cancel", "<Keyboard>/escape", "<Gamepad>/select");

            NextSlot = map.AddAction("NextSlot", InputActionType.Button, "<Gamepad>/rightShoulder");
            PreviousSlot = map.AddAction("PreviousSlot", InputActionType.Button, "<Gamepad>/leftShoulder");
            // The wheel is an axis, not a button, so it is polled rather than
            // bound to the cycle actions.
            Scroll = map.AddAction("Scroll", InputActionType.Value, "<Mouse>/scroll/y");

            SlotKeys = new InputAction[InventoryState.QuickSlotCount];
            for (var i = 0; i < SlotKeys.Length; i++)
                SlotKeys[i] = map.AddAction($"Slot{i + 1}", InputActionType.Button, $"<Keyboard>/{i + 1}");

            Context.performed += _ => pending.Enqueue(DungeonCommand.Context());
            Shove.performed += _ => pending.Enqueue(DungeonCommand.Shove());
            UseHeld.performed += _ => pending.Enqueue(DungeonCommand.UseHeld());
            QuickConsumable.performed += _ => pending.Enqueue(DungeonCommand.UseQuickConsumable());
            Wait.performed += _ => pending.Enqueue(DungeonCommand.Wait());

            LoadOverrides();
            map.Enable();
        }

        public InputAction Context { get; }

        public InputAction Shove { get; }

        public InputAction UseHeld { get; }

        public InputAction QuickConsumable { get; }

        public InputAction Wait { get; }

        public InputAction Bag { get; }

        public InputAction Cancel { get; }

        public InputAction NextSlot { get; }

        public InputAction PreviousSlot { get; }

        public InputAction Scroll { get; }

        public InputAction[] SlotKeys { get; }

        /// <summary>-1, 0 or 1: how far to cycle the held slot this frame. Changing
        /// the selection never costs a dungeon turn, so it is read separately from
        /// <see cref="Next"/>.</summary>
        public int SlotCycleThisFrame()
        {
            if (NextSlot.WasPressedThisFrame()) return 1;
            if (PreviousSlot.WasPressedThisFrame()) return -1;

            var wheel = Scroll.ReadValue<float>();
            if (wheel > 0.5f) return -1;
            if (wheel < -0.5f) return 1;
            return 0;
        }

        /// <summary>The quick slot the player pressed a number key for, or -1.</summary>
        public int SlotKeyThisFrame()
        {
            for (var i = 0; i < SlotKeys.Length; i++)
                if (SlotKeys[i].WasPressedThisFrame())
                    return i;
            return -1;
        }

        private InputAction Button(string name, string keyboard, string gamepad)
        {
            var action = map.AddAction(name, InputActionType.Button, keyboard);
            action.AddBinding(gamepad);
            return action;
        }

        /// <summary>
        /// The next command the player asked for, or null. Movement is polled with
        /// a repeat timer so holding a direction walks steadily, while the discrete
        /// actions arrive through callbacks and are never dropped.
        /// </summary>
        public DungeonCommand? Next(bool acceptMovement)
        {
            if (pending.Count > 0) return pending.Dequeue();
            if (!acceptMovement) return null;

            var direction = Snap(move.ReadValue<Vector2>());
            if (direction == default)
            {
                lastDirection = Vector2.zero;
                return null;
            }

            var vector = new Vector2(direction.X, direction.Y);
            if (vector != lastDirection)
            {
                lastDirection = vector;
                repeatAt = Time.time + RepeatDelay;
                return DungeonCommand.Move(direction);
            }

            if (Time.time < repeatAt) return null;
            repeatAt = Time.time + RepeatInterval;
            return DungeonCommand.Move(direction);
        }

        /// <summary>Cardinal only. A diagonal stick reading picks the dominant axis,
        /// because the grid has no diagonal steps.</summary>
        private static GridPos Snap(Vector2 raw)
        {
            if (raw.sqrMagnitude < 0.25f) return default;
            return Mathf.Abs(raw.x) > Mathf.Abs(raw.y)
                ? raw.x < 0f ? GridPos.Left : GridPos.Right
                : raw.y < 0f ? GridPos.Down : GridPos.Up;
        }

        /// <summary>The key currently bound to an action, for the field prompt. Read
        /// live rather than hard-coded so a rebind updates what the prompt says.</summary>
        public static string KeyLabel(InputAction action)
        {
            return action.GetBindingDisplayString(group: null, options: InputBinding.DisplayStringOptions.DontUseShortDisplayNames);
        }

        public void Flush() => pending.Clear();

        public void SaveOverrides()
        {
            PlayerPrefs.SetString(OverridesKey, map.SaveBindingOverridesAsJson());
            PlayerPrefs.Save();
        }

        private void LoadOverrides()
        {
            var json = PlayerPrefs.GetString(OverridesKey, null);
            if (!string.IsNullOrEmpty(json)) map.LoadBindingOverridesFromJson(json);
        }

        public void Dispose()
        {
            map.Disable();
            map.Dispose();
        }
    }
}
