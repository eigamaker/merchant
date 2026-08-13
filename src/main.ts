import "./style.css";
import "@fontsource-variable/noto-sans-jp";
import Phaser from "phaser";
import { MerchantScene } from "./scenes/MerchantScene";

const shell = document.querySelector<HTMLElement>("#app");
if (!shell) throw new Error("#app が見つかりません");

shell.innerHTML = '<div class="game-shell"><div id="game"></div></div>';

await document.fonts.load('12px "Noto Sans JP Variable"');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 640,
  height: 360,
  backgroundColor: "#151320",
  pixelArt: true,
  render: { antialias: false, roundPixels: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [MerchantScene],
});

export { game };
