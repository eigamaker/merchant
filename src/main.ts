import "./style.css";
import "@fontsource-variable/noto-sans-jp";
import Phaser from "phaser";
import { MerchantScene } from "./scenes/MerchantScene";
import { UI_BASE_HEIGHT, UI_BASE_WIDTH, UI_PIXEL_SCALE } from "./game/uiTheme";

const shell = document.querySelector<HTMLElement>("#app");
if (!shell) throw new Error("#app が見つかりません");

shell.innerHTML = '<div class="game-shell"><div id="game"></div></div>';

await document.fonts.load('12px "Noto Sans JP Variable"');

// The canvas is the layout grid times UI_PIXEL_SCALE; the scene magnifies its
// camera by the same factor, so scene coordinates stay on the 640x360 grid.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: UI_BASE_WIDTH * UI_PIXEL_SCALE,
  height: UI_BASE_HEIGHT * UI_PIXEL_SCALE,
  backgroundColor: "#151320",
  pixelArt: true,
  render: { antialias: false, roundPixels: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [MerchantScene],
});

export { game };
