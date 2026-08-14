/** Reusable RPG UI skin. Text is rendered by the game, never baked into the art. */

export interface UiSliceAsset {
  id: string;
  path: string;
  /** Source atlas is pixel art; these are source-pixel insets. */
  slice: { left: number; top: number; right: number; bottom: number };
}

export interface UiButtonAsset {
  id: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  frame: number;
  /** Keep the button label outside the image so Japanese text remains selectable. */
  hasBakedLabel: false;
}

export const CRAFTPIX_UI = {
  panel: {
    id: "craftpix-ui-panel",
    path: "assets/ui/craftpix/Main_tiles.png",
    slice: { left: 16, top: 16, right: 16, bottom: 16 },
  } satisfies UiSliceAsset,
  buttons: {
    id: "craftpix-ui-buttons",
    path: "assets/ui/craftpix/Buttons.png",
    frameWidth: 80,
    frameHeight: 48,
    frame: 0,
    hasBakedLabel: false,
  } satisfies UiButtonAsset,
  icons: {
    id: "craftpix-ui-icons",
    path: "assets/ui/craftpix/Icons.png",
    frameWidth: 16,
    frameHeight: 16,
  },
  characterPanel: {
    id: "craftpix-ui-character-panel",
    path: "assets/ui/craftpix/character_panel.png",
    frameWidth: 192,
    frameHeight: 160,
  },
} as const;

export type UiSkinId = keyof typeof CRAFTPIX_UI;
