import Phaser from "phaser";
import { ASSET_MANIFEST } from "../game/assets";
import {
  DIRECTION,
  acceptQuest,
  activeQuestSummary,
  appraiseItem,
  beginExpedition,
  createNewGame,
  currentBulk,
  initialOffer,
  itemBulk,
  itemName,
  movePlayer,
  moveToStore,
  returnToTown,
  sellItem,
  toggleDisplay,
  tryOpenChest,
  tryPickup,
  tryStairs,
  useSmokeBomb,
} from "../game/engine";
import { SaveRepository, type SaveSlot } from "../game/save";
import {
  moveTownPosition,
  TOWN_BUILDINGS,
  TOWN_HEIGHT,
  TOWN_POINTS,
  TOWN_PLOTS,
  TOWN_TILE,
  TOWN_WIDTH,
  TOWN_WORLD_HEIGHT,
  TOWN_WORLD_WIDTH,
  townSurfaceAt,
  type TownBuilding,
  type TownPointOfInterest,
  type TownPlot,
} from "../game/townMap";
import type { Customer, GameState, ItemInstance, MenuChoice, Vec } from "../game/types";

const TILE = 24;
const GRID_W = 21;
const GRID_H = 12;
const MAP_W = GRID_W * TILE;
const MAP_H = GRID_H * TILE;
const PANEL_X = MAP_W + 8;

type Modal = {
  title: string;
  body: string[];
  choices: MenuChoice[];
  index: number;
};

function same(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

function distanceSquared(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export class MerchantScene extends Phaser.Scene {
  private state: GameState = createNewGame();
  private modal?: Modal;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly saves = new SaveRepository();
  private gameStarted = false;
  private lastAutoSaveAt = Number.NEGATIVE_INFINITY;
  private townWorld?: Phaser.GameObjects.Container;
  private townPlayer?: Phaser.GameObjects.Image;

  constructor() {
    super("merchant");
  }

  create(): void {
    if (!this.input.keyboard) throw new Error("キーボード入力を初期化できませんでした。");
    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      escape: Phaser.Input.Keyboard.KeyCodes.ESC,
      i: Phaser.Input.Keyboard.KeyCodes.I,
      l: Phaser.Input.Keyboard.KeyCodes.L,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
      r: Phaser.Input.Keyboard.KeyCodes.R,
      h: Phaser.Input.Keyboard.KeyCodes.H,
      z: Phaser.Input.Keyboard.KeyCodes.Z,
      f1: Phaser.Input.Keyboard.KeyCodes.F1,
      f2: Phaser.Input.Keyboard.KeyCodes.F2,
      f3: Phaser.Input.Keyboard.KeyCodes.F3,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.createPlaceholderTextures();
    void this.openTitle();
  }

  update(_time: number, delta: number): void {
    if (this.gameStarted && this.just("escape")) {
      this.modal = undefined;
      this.render();
      return;
    }

    if (this.modal) {
      let changed = false;
      if (this.just("up") || this.just("w")) {
        this.modal.index = (this.modal.index - 1 + this.modal.choices.length) % this.modal.choices.length;
        changed = true;
      }
      if (this.just("down") || this.just("s")) {
        this.modal.index = (this.modal.index + 1) % this.modal.choices.length;
        changed = true;
      }
      if (this.just("enter") || this.just("space")) {
        const choice = this.modal.choices[this.modal.index];
        if (choice && !choice.disabled) choice.action();
        changed = true;
      }
      if (changed) this.render();
      return;
    }

    if (!this.gameStarted) return;

    if (this.state.location === "town") this.updateTown(delta);
    else this.updateDungeon();
  }

  private just(key: string): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keys[key]!);
  }

  private createPlaceholderTextures(): void {
    const texture = (name: string, colors: [number, number]): void => {
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(colors[0], 1).fillRect(2, 3, 20, 19);
      graphics.fillStyle(colors[1], 1).fillRect(5, 1, 14, 7);
      graphics.fillStyle(0x191521, 1).fillRect(6, 9, 3, 3).fillRect(15, 9, 3, 3);
      graphics.generateTexture(name, TILE, TILE);
      graphics.destroy();
    };
    texture(ASSET_MANIFEST.player.textureKey, [0xead8b6, 0x9d4a59]);
    texture(ASSET_MANIFEST.enemy.textureKey, [0x6a476d, 0xd06f87]);
    texture(ASSET_MANIFEST.npc.textureKey, [0xc29f70, 0x6c6b94]);
    texture(ASSET_MANIFEST.item.textureKey, [0xc9af58, 0xffeb91]);
  }

  private updateTown(delta: number): void {
    let moved = false;
    const horizontal = Number(this.keys.right.isDown || this.keys.d.isDown) - Number(this.keys.left.isDown || this.keys.a.isDown);
    const vertical = Number(this.keys.down.isDown || this.keys.s.isDown) - Number(this.keys.up.isDown || this.keys.w.isDown);
    if (horizontal !== 0 || vertical !== 0) {
      const length = Math.hypot(horizontal, vertical);
      const speed = 126;
      const next = moveTownPosition(this.state.townPos, {
        x: (horizontal / length) * speed * (delta / 1000),
        y: (vertical / length) * speed * (delta / 1000),
      });
      moved = next.x !== this.state.townPos.x || next.y !== this.state.townPos.y;
      this.state.townPos = next;
    }
    const interact = this.just("enter") || this.just("space");
    const inventory = this.just("i");
    const ledger = this.just("l");
    const quest = this.just("q");
    const help = this.just("h");
    if (interact) this.interactTown();
    if (inventory) this.openInventory();
    if (ledger) this.openLedger();
    if (quest) this.openQuestBoard();
    if (help) this.openHelp();
    if (this.just("f1")) void this.saveManual("manual-1");
    if (this.just("f2")) void this.saveManual("manual-2");
    if (this.just("f3")) void this.saveManual("manual-3");
    if (moved) {
      this.updateTownPresentation();
      this.saveAuto();
    }
    if (interact || inventory || ledger || quest || help) this.render();
  }

  private updateDungeon(): void {
    let acted = false;
    if (this.just("up") || this.just("w")) { movePlayer(this.state, DIRECTION.up); acted = true; }
    else if (this.just("down") || this.just("s")) { movePlayer(this.state, DIRECTION.down); acted = true; }
    else if (this.just("left") || this.just("a")) { movePlayer(this.state, DIRECTION.left); acted = true; }
    else if (this.just("right") || this.just("d")) { movePlayer(this.state, DIRECTION.right); acted = true; }
    if (this.just("enter") || this.just("space")) { this.interactDungeon(); acted = true; }
    if (this.just("r")) {
      if (this.state.returnStones > 0) {
        this.state.returnStones -= 1;
        returnToTown(this.state, false);
      } else {
        this.state.message = "帰還石はもうない。入口まで戻ろう。";
      }
      acted = true;
    }
    if (this.just("z")) { useSmokeBomb(this.state); acted = true; }
    if (this.just("i")) this.openInventory();
    if (this.just("l")) this.openLedger();
    if (this.just("h")) this.openHelp();
    if (acted || this.just("i") || this.just("l") || this.just("h")) this.render();
  }

  private interactTown(): void {
    const poi = TOWN_POINTS.find((entry) => distanceSquared(this.poiPosition(entry), this.state.townPos) <= 30 * 30);
    if (!poi) {
      this.state.message = "近くに話せる相手や施設はない。";
      return;
    }
    switch (poi.kind) {
      case "entrance":
        beginExpedition(this.state);
        return;
      case "shop":
        this.openStore();
        return;
      case "guild":
        this.openQuestBoard();
        return;
      case "tavern":
        this.openMenu("酒場の噂", ["「地下3階で、光を吸う黒い剣を見た者がいる」", "「深く潜るほど、帰還石は手放せないぞ」"], [{ label: "閉じる", action: () => this.closeMenu() }]);
        return;
      case "customer":
        if (poi.customerId) this.openCustomer(poi.customerId);
        return;
    }
  }

  private interactDungeon(): void {
    const run = this.state.run;
    if (!run) return;
    if (run.items.some((entry) => same(entry.pos, run.player))) {
      tryPickup(this.state);
      return;
    }
    if (tryOpenChest(this.state)) return;
    if (same(run.player, run.map.stairs) || same(run.player, run.map.returnStairs)) {
      tryStairs(this.state);
      return;
    }
    this.state.message = "何も見つからない。";
  }

  private poiPosition(poi: TownPointOfInterest): Vec {
    return { x: poi.pos.x * TILE + TILE / 2, y: poi.pos.y * TILE + TILE / 2 };
  }

  private openMenu(title: string, body: string[], choices: MenuChoice[]): void {
    this.modal = { title, body, choices, index: 0 };
  }

  private closeMenu(): void {
    this.modal = undefined;
    this.render();
  }

  private async openTitle(): Promise<void> {
    const available = await this.saves.availableSlots();
    const choices: MenuChoice[] = [
      { label: "新しい商人として始める", action: () => { this.state = createNewGame(); this.gameStarted = true; this.closeMenu(); } },
      ...(["autosave", "manual-1", "manual-2", "manual-3"] as SaveSlot[]).map((slot) => ({
        label: slot === "autosave" ? "自動保存を再開" : `手動保存 ${slot.at(-1)} を読み込む`,
        disabled: !available.includes(slot),
        action: () => { void this.loadSlot(slot); },
      })),
    ];
    this.openMenu("Dungeon Curio Merchant", ["命懸けで珍品を持ち帰り、価値を見抜く商人RPG。", "自動保存1枠・手動保存3枠。"], choices);
    this.render();
  }

  private async loadSlot(slot: SaveSlot): Promise<void> {
    const saved = await this.saves.load(slot);
    if (!saved) return;
    this.state = saved.state;
    this.gameStarted = true;
    this.modal = undefined;
    this.state.message = `${slot === "autosave" ? "自動保存" : "手動保存"}を読み込んだ。`;
    this.render();
  }

  private async saveManual(slot: SaveSlot): Promise<void> {
    await this.saves.save(slot, this.state);
    this.state.message = `${slot.replace("manual-", "手動保存 ")}へ記録した。`;
    this.render();
  }

  private saveAuto(): void {
    if (!this.gameStarted) return;
    const now = performance.now();
    if (now - this.lastAutoSaveAt < 750) return;
    this.lastAutoSaveAt = now;
    void this.saves.save("autosave", this.state).catch(() => undefined);
  }

  private openHelp(): void {
    const controls = this.state.location === "town"
      ? ["移動: 矢印 / WASD", "決定・会話: Enter / Space", "I: 持ち物  L: 商人の記録", "Q: 依頼  F1〜F3: 手動保存", "H: ヘルプ"]
      : ["移動・弱攻撃: 矢印 / WASD", "拾う・階段: Enter / Space", "Z: 煙玉  R: 帰還石（町へ戻る）", "I: 持ち物  L: 商人の記録"];
    this.openMenu("操作", controls, [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openInventory(): void {
    const items = this.state.inventory;
    if (items.length === 0) {
      this.openMenu("持ち物", ["持ち物は空だ。", `容量 ${currentBulk(this.state)} / 12`], [{ label: "閉じる", action: () => this.closeMenu() }]);
      return;
    }
    this.openMenu("持ち物", [`容量 ${currentBulk(this.state)} / 12`, "品を選ぶと詳細を確認できる。"], [
      ...items.map((item) => ({ label: `${itemName(item)} [${itemBulk(item)}]`, action: () => this.openItemMenu(item) })),
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openItemMenu(item: ItemInstance): void {
    const definition = item.definitionId;
    const lines = [
      itemName(item),
      `知識: ${item.knowledge === "unknown" ? "未鑑定" : item.knowledge === "suspected" ? "推測" : "判明"}`,
      `容量: ${itemBulk(item)}  ${definition}`,
    ];
    const choices: MenuChoice[] = [];
    if (this.state.location === "town") {
      choices.push({ label: "店へ保管する", action: () => { moveToStore(this.state, item); this.openStore(); } });
      choices.push({ label: "買い手を探す", action: () => this.openCustomerList(item) });
    }
    choices.push({ label: "戻る", action: () => this.openInventory() });
    this.openMenu("品物の詳細", lines, choices);
  }

  private openStore(): void {
    const lines = [`保管品 ${this.state.store.length}点 / 展示 ${this.state.display.length}点`, "展示品は特別な来客を呼ぶことがある。"];
    const choices: MenuChoice[] = [
      ...this.state.inventory.map((item) => ({ label: `保管する: ${itemName(item)}`, action: () => { moveToStore(this.state, item); this.openStore(); } })),
      ...this.state.store.map((item) => ({ label: `保管品: ${itemName(item)}${this.state.display.includes(item.uuid) ? " ★展示中" : ""}`, action: () => this.openStoredItem(item) })),
      { label: "閉じる", action: () => this.closeMenu() },
    ];
    this.openMenu("珍品店", lines, choices);
  }

  private openStoredItem(item: ItemInstance): void {
    const showing = this.state.display.includes(item.uuid);
    this.openMenu(itemName(item), ["店の保管庫にある一点物。", `現在: ${showing ? "展示中" : "保管中"}`], [
      { label: showing ? "展示をやめる" : "展示する", action: () => { toggleDisplay(this.state, item); this.openStore(); } },
      { label: "買い手を探す", action: () => this.openCustomerList(item) },
      { label: "持ち物へ戻す", action: () => this.retrieveItem(item) },
      { label: "戻る", action: () => this.openStore() },
    ]);
  }

  private retrieveItem(item: ItemInstance): void {
    if (currentBulk(this.state) + itemBulk(item) > 12) {
      this.openMenu("持ち物がいっぱい", ["持ち物の容量を空けてから取り出そう。"], [{ label: "戻る", action: () => this.openStoredItem(item) }]);
      return;
    }
    this.state.store = this.state.store.filter((entry) => entry.uuid !== item.uuid);
    this.state.display = this.state.display.filter((uuid) => uuid !== item.uuid);
    item.owner = "player";
    this.state.inventory.push(item);
    this.state.message = `${itemName(item)}を持ち物へ戻した。`;
    this.openStore();
  }

  private openCustomerList(item?: ItemInstance): void {
    this.openMenu("誰に見せる？", [item ? `${itemName(item)}を見せる相手を選ぶ。` : "相手を選ぶ。"], [
      ...this.state.customers.map((customer) => ({ label: `${customer.name}（${customer.title}）`, action: () => item ? this.openOffer(item, customer) : this.openCustomer(customer.id) })),
      { label: "戻る", action: () => item ? (this.state.store.includes(item) ? this.openStoredItem(item) : this.openItemMenu(item)) : this.closeMenu() },
    ]);
  }

  private openCustomer(customerId: string): void {
    const customer = this.state.customers.find((entry) => entry.id === customerId);
    if (!customer) return;
    const items = [...this.state.inventory, ...this.state.store];
    const choices: MenuChoice[] = [
      ...items.map((item) => ({ label: `品を見せる: ${itemName(item)}`, action: () => this.openOffer(item, customer) })),
    ];
    if (customer.id === "scholar" && this.state.story.blackSword === "tomb") {
      choices.unshift({ label: "墓所の碑文を照合する", action: () => this.resolveBlackSword(customer) });
    }
    choices.push({ label: "閉じる", action: () => this.closeMenu() });
    this.openMenu(`${customer.name} — ${customer.title}`, [
      `関係: ${customer.relation >= 0 ? "+" : ""}${customer.relation}`,
      `興味: ${customer.interests.join(" / ")}`,
      items.length > 0 ? "品を選んで、鑑定または売却できる。" : "売れる品を持っていない。",
    ], choices);
  }

  private resolveBlackSword(customer: Customer): void {
    const sword = this.state.archive.find((item) => item.definitionId === "black-sword");
    if (!sword) return;
    const result = appraiseItem(this.state, sword, customer);
    this.openMenu("碑文の照合", [result, "商品帳簿の表示名が更新された。"], [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openOffer(item: ItemInstance, customer: Customer): void {
    const offer = initialOffer(this.state, item, customer);
    const explain = `${customer.name}の提示額: ${offer}G`;
    this.openMenu(`${itemName(item)}の取引`, [explain, "反提案は一度だけ。高すぎれば関係が悪化する。"], [
      { label: `${offer}Gで売る`, action: () => this.finishSale(item, customer, 1) },
      { label: `${Math.floor(offer * 1.1)}Gを提案`, action: () => this.finishSale(item, customer, 1.1) },
      { label: `${Math.floor(offer * 1.25)}Gを提案`, action: () => this.finishSale(item, customer, 1.25) },
      { label: `${Math.floor(offer * 1.5)}Gを提案`, action: () => this.finishSale(item, customer, 1.5) },
      { label: "鑑定だけして戻る", action: () => this.finishAppraisal(item, customer) },
      { label: "やめる", action: () => this.openCustomer(customer.id) },
    ]);
  }

  private finishAppraisal(item: ItemInstance, customer: Customer): void {
    const result = appraiseItem(this.state, item, customer);
    this.openMenu("鑑定結果", [result], [{ label: "戻る", action: () => this.openCustomer(customer.id) }]);
  }

  private finishSale(item: ItemInstance, customer: Customer, multiplier: number): void {
    const result = sellItem(this.state, item, customer.id, multiplier);
    this.openMenu("取引結果", [result, `所持金: ${this.state.gold}G`], [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private openQuestBoard(): void {
    const active = activeQuestSummary(this.state).split("\n");
    this.openMenu("冒険者ギルド", ["受注中", ...active, "", "受ける依頼を選ぶ。"], [
      ...this.state.quests.map((quest) => ({
        label: `${quest.status === "active" ? "▶" : quest.status === "complete" ? "✓" : "○"} ${quest.title}`,
        disabled: quest.status !== "available",
        action: () => { acceptQuest(this.state, quest.id); this.openQuestBoard(); },
      })),
      { label: "閉じる", action: () => this.closeMenu() },
    ]);
  }

  private openLedger(): void {
    const all = [...this.state.inventory, ...this.state.store, ...this.state.archive];
    const unique = Array.from(new Map(all.map((item) => [item.uuid, item])).values());
    const lines = unique.length === 0
      ? ["まだ記録すべき品を扱っていない。"]
      : unique.slice(-8).map((item) => {
        const latest = item.history.at(-1);
        return `${itemName(item)} — ${latest?.detail ?? "記録なし"}`;
      });
    this.openMenu("商人の記録", lines, [{ label: "閉じる", action: () => this.closeMenu() }]);
  }

  private render(): void {
    this.children.removeAll(true);
    if (this.state.location === "town") this.renderTown();
    else this.renderDungeon();
    this.renderHud();
    if (this.modal) this.renderModal();
    this.saveAuto();
  }

  private renderTown(): void {
    const world = this.add.container(0, 0);
    const ground = this.add.graphics();
    const front = this.add.graphics();
    world.add(ground);
    this.drawTownGround(ground);
    this.drawTownPlots(ground, TOWN_PLOTS);
    for (const building of TOWN_BUILDINGS) this.drawTownBuilding(ground, building);
    this.drawTownLandmarks(ground);
    const player = this.add.image(this.state.townPos.x, this.state.townPos.y, ASSET_MANIFEST.player.textureKey);
    world.add(player);
    this.townPlayer = player;
    world.add(front);
    for (const building of TOWN_BUILDINGS) this.drawTownRoofFront(front, building);
    this.drawTownNpcs(front);
    for (const poi of TOWN_POINTS.filter((entry) => entry.kind !== "customer")) {
      const position = this.poiPosition(poi);
      const label = this.add.text(position.x, position.y - 12, poi.name, { fontSize: "6px", color: "#fff2d7", stroke: "#251d25", strokeThickness: 2 }).setOrigin(0.5);
      world.add(label);
    }
    this.townWorld = world;
    this.updateTownPresentation(true);
    this.add.text(8, 8, `灰灯町 — ${this.state.day}日目`, { fontSize: "11px", color: "#fff2d7", stroke: "#1b1620", strokeThickness: 3 });
  }

  private renderDungeon(): void {
    const run = this.state.run;
    if (!run) return;
    const terrain = this.add.graphics();
    for (let y = 0; y < run.map.height; y += 1) {
      for (let x = 0; x < run.map.width; x += 1) {
        const wall = run.map.tiles[y]![x] === 1;
        const px = x * TILE;
        const py = y * TILE;
        const noise = (run.seed * 31 + x * 17 + y * 43) >>> 0;
        if (!wall) {
          terrain.fillStyle(noise % 3 === 0 ? 0x655c55 : 0x71655a, 1).fillRect(px, py, TILE, TILE);
          terrain.fillStyle(0x4d4745, 0.45).fillRect(px + 4 + (noise % 7), py + 5 + ((noise >> 3) % 8), 2, 1);
          if (noise % 11 === 0) terrain.fillStyle(0x88906e, 0.7).fillRect(px + 15, py + 17, 3, 2);
        } else {
          terrain.fillStyle(0x332d38, 1).fillRect(px, py, TILE, TILE);
          terrain.fillStyle(noise % 2 === 0 ? 0x4d4551 : 0x443e49, 1).fillRect(px + 2, py + 2, TILE - 4, TILE - 5);
          terrain.fillStyle(0x27222d, 1).fillRect(px, py + 18, TILE, 6);
          if (run.map.tiles[y + 1]?.[x] === 0) {
            terrain.fillStyle(0x211d27, 0.65).fillRect(px, py + 20, TILE, 4);
            terrain.lineStyle(1, 0x786b75, 0.75).lineBetween(px + 2, py + 18, px + TILE - 3, py + 18);
          }
          if (noise % 5 === 0) terrain.lineStyle(1, 0x74636d, 0.6).lineBetween(px + 8, py + 5, px + 11, py + 13);
        }
      }
    }
    this.add.text(run.map.stairs.x * TILE + 12, run.map.stairs.y * TILE + 11, "▼", { fontSize: "15px", color: "#f6e59c" }).setOrigin(0.5);
    this.add.text(run.map.returnStairs.x * TILE + 12, run.map.returnStairs.y * TILE + 11, "▲", { fontSize: "15px", color: "#d7edff" }).setOrigin(0.5);
    if (run.map.specialRoom) this.add.text(run.map.specialRoom.x * TILE + 12, run.map.specialRoom.y * TILE + 10, "†", { fontSize: "15px", color: "#c7a5d7" }).setOrigin(0.5);
    for (const entry of run.items) this.add.image(entry.pos.x * TILE + 12, entry.pos.y * TILE + 12, ASSET_MANIFEST.item.textureKey).setScale(0.58);
    for (const chest of run.chests) this.add.rectangle(chest.x * TILE + 12, chest.y * TILE + 14, 15, 11, 0xa66d3f).setStrokeStyle(1, 0xffd27c);
    for (const trap of run.traps) this.add.text(trap.x * TILE + 12, trap.y * TILE + 11, "^", { fontSize: "16px", color: "#cc7168" }).setOrigin(0.5);
    for (const body of run.bodies) this.add.text(body.x * TILE + 12, body.y * TILE + 11, "☠", { fontSize: "13px", color: "#d5d1c8" }).setOrigin(0.5);
    for (const enemy of run.enemies) this.add.image(enemy.pos.x * TILE + 12, enemy.pos.y * TILE + 12, ASSET_MANIFEST.enemy.textureKey);
    this.add.image(run.player.x * TILE + 12, run.player.y * TILE + 12, ASSET_MANIFEST.player.textureKey);
    this.add.text(8, 8, `深層ダンジョン 地下${run.floor}階 / ${run.turn}手`, { fontSize: "11px", color: "#fff2d7", stroke: "#1b1620", strokeThickness: 3 });
  }

  private updateTownPresentation(immediate = false): void {
    if (!this.townWorld || !this.townPlayer) return;
    this.townPlayer.setPosition(this.state.townPos.x, this.state.townPos.y);
    const targetX = Phaser.Math.Clamp(this.state.townPos.x - MAP_W / 2, 0, TOWN_WORLD_WIDTH - MAP_W);
    const targetY = Phaser.Math.Clamp(this.state.townPos.y - MAP_H / 2, 0, TOWN_WORLD_HEIGHT - MAP_H);
    const currentX = -this.townWorld.x;
    const currentY = -this.townWorld.y;
    const nextX = immediate ? targetX : Phaser.Math.Linear(currentX, targetX, 0.18);
    const nextY = immediate ? targetY : Phaser.Math.Linear(currentY, targetY, 0.18);
    this.townWorld.setPosition(-Math.round(nextX), -Math.round(nextY));
  }

  private drawTownGround(graphics: Phaser.GameObjects.Graphics): void {
    for (let y = 0; y < TOWN_HEIGHT; y += 1) {
      for (let x = 0; x < TOWN_WIDTH; x += 1) {
        const px = x * TOWN_TILE;
        const py = y * TOWN_TILE;
        const surface = townSurfaceAt(x, y);
        const seed = (x * 73856093 ^ y * 19349663) >>> 0;
        const color = surface === "grass" ? (seed % 3 === 0 ? 0x496b45 : 0x526f49)
          : surface === "road" ? 0x9b8561
            : surface === "plaza" ? 0x8a8171
              : surface === "dock" ? 0x805b3e : 0x26616a;
        graphics.fillStyle(color, 1).fillRect(px, py, TOWN_TILE, TOWN_TILE);
        if (surface === "grass") {
          graphics.fillStyle(seed % 2 ? 0x6f8b58 : 0x3d5d3e, 0.7).fillRect(px + 3 + (seed % 11), py + 4 + ((seed >> 4) % 13), 2, 2);
          if (seed % 9 === 0) graphics.fillStyle(0xd5bc76, 0.8).fillRect(px + 16, py + 7, 1, 1);
        } else if (surface === "road" || surface === "plaza") {
          graphics.fillStyle(surface === "road" ? 0xc0a97a : 0xb3aa97, 0.42).fillRect(px + 3 + (seed % 10), py + 4 + ((seed >> 3) % 12), 3, 2);
        } else if (surface === "water") {
          graphics.lineStyle(1, 0x63a4a5, 0.65).lineBetween(px + 3, py + 7 + (seed % 8), px + 14, py + 7 + (seed % 8));
        } else {
          graphics.fillStyle(0xae8055, 0.8).fillRect(px + 2, py + 3, TOWN_TILE - 4, 3);
          graphics.lineStyle(1, 0x4e382d, 0.75).lineBetween(px + 3, py + 12, px + TOWN_TILE - 3, py + 12);
        }
      }
    }
  }

  private drawTownPlots(graphics: Phaser.GameObjects.Graphics, plots: TownPlot[]): void {
    for (const plot of plots) {
      const px = plot.x * TOWN_TILE;
      const py = plot.y * TOWN_TILE;
      if (plot.kind === "farm") {
        graphics.fillStyle(0x765d3b, 0.8).fillRect(px + TOWN_TILE, py + TOWN_TILE, (plot.width - 2) * TOWN_TILE, (plot.height - 2) * TOWN_TILE);
        for (let y = plot.y + 1; y < plot.y + plot.height - 1; y += 2) for (let x = plot.x + 1; x < plot.x + plot.width - 1; x += 2) {
          graphics.fillStyle(0x6b944d, 1).fillCircle(x * TOWN_TILE + 12, y * TOWN_TILE + 13, 4);
          graphics.fillStyle(0xb6d46e, 0.9).fillRect(x * TOWN_TILE + 11, y * TOWN_TILE + 7, 2, 5);
        }
      } else if (plot.kind === "pen") {
        graphics.fillStyle(0x867254, 0.65).fillRect(px + TOWN_TILE, py + TOWN_TILE, (plot.width - 2) * TOWN_TILE, (plot.height - 2) * TOWN_TILE);
        graphics.fillStyle(0xd1b686, 1).fillCircle(px + 86, py + 76, 6).fillCircle(px + 172, py + 96, 5);
      } else {
        graphics.fillStyle(0x6d7a50, 0.45).fillRect(px + TOWN_TILE, py + TOWN_TILE, (plot.width - 2) * TOWN_TILE, (plot.height - 2) * TOWN_TILE);
      }
      this.drawFence(graphics, plot);
    }
  }

  private drawFence(graphics: Phaser.GameObjects.Graphics, plot: TownPlot): void {
    const gates = new Set(plot.gates.map((gate) => `${gate.x},${gate.y}`));
    graphics.lineStyle(2, 0x4d3529, 1);
    for (let x = plot.x; x < plot.x + plot.width; x += 1) {
      if (!gates.has(`${x},${plot.y}`)) graphics.lineBetween(x * TOWN_TILE, plot.y * TOWN_TILE + 4, (x + 1) * TOWN_TILE, plot.y * TOWN_TILE + 4);
      const bottom = plot.y + plot.height - 1;
      if (!gates.has(`${x},${bottom}`)) graphics.lineBetween(x * TOWN_TILE, (bottom + 1) * TOWN_TILE - 4, (x + 1) * TOWN_TILE, (bottom + 1) * TOWN_TILE - 4);
    }
    for (let y = plot.y; y < plot.y + plot.height; y += 1) {
      if (!gates.has(`${plot.x},${y}`)) graphics.lineBetween(plot.x * TOWN_TILE + 4, y * TOWN_TILE, plot.x * TOWN_TILE + 4, (y + 1) * TOWN_TILE);
      const right = plot.x + plot.width - 1;
      if (!gates.has(`${right},${y}`)) graphics.lineBetween((right + 1) * TOWN_TILE - 4, y * TOWN_TILE, (right + 1) * TOWN_TILE - 4, (y + 1) * TOWN_TILE);
    }
    graphics.fillStyle(0x8e6542, 1);
    for (let x = plot.x; x <= plot.x + plot.width; x += 1) {
      graphics.fillRect(x * TOWN_TILE + 2, plot.y * TOWN_TILE, 4, 7);
      graphics.fillRect(x * TOWN_TILE + 2, (plot.y + plot.height) * TOWN_TILE - 7, 4, 7);
    }
  }

  private drawTownBuilding(graphics: Phaser.GameObjects.Graphics, building: TownBuilding): void {
    const px = building.x * TOWN_TILE;
    const py = building.y * TOWN_TILE;
    const width = building.width * TOWN_TILE;
    const height = building.height * TOWN_TILE;
    graphics.fillStyle(0x1e2021, 0.28).fillRect(px + 5, py + 8, width, height);
    graphics.fillStyle(building.wall, 1).fillRect(px + 3, py + 18, width - 6, height - 21);
    graphics.fillStyle(0x573e32, 1);
    for (let x = px + 8; x < px + width - 5; x += 18) graphics.fillRect(x, py + 18, 3, height - 21);
    graphics.fillStyle(building.roof, 1).fillTriangle(px, py + 24, px + width / 2, py - 8, px + width, py + 24);
    graphics.fillStyle(0xd1b173, 0.5);
    for (let offset = 6; offset < width - 4; offset += 10) graphics.fillRect(px + offset, py + 8 + Math.abs(width / 2 - offset) * 0.2, 7, 2);
    const doorX = building.entrance.x * TOWN_TILE + 5;
    graphics.fillStyle(0x453126, 1).fillRect(doorX, py + height - 14, 14, 14);
    graphics.fillStyle(building.accent, 1).fillRect(doorX + 10, py + height - 7, 2, 2);
    for (let window = px + 18; window < px + width - 18; window += 28) {
      graphics.fillStyle(0x3d5b68, 1).fillRect(window, py + height - 20, 8, 7);
      graphics.lineStyle(1, 0xe9d59d, 0.75).strokeRect(window, py + height - 20, 8, 7);
    }
    graphics.fillStyle(building.accent, 1).fillRect(px + width / 2 - 7, py + height - 28, 14, 6);
  }

  private drawTownRoofFront(graphics: Phaser.GameObjects.Graphics, building: TownBuilding): void {
    const px = building.x * TOWN_TILE;
    const py = building.y * TOWN_TILE;
    const width = building.width * TOWN_TILE;
    const bottom = py + 24;
    graphics.fillStyle(0x201c25, 0.32).fillRect(px + 2, bottom - 2, width - 4, 5);
    graphics.lineStyle(2, 0x32272a, 0.9).lineBetween(px + 2, bottom, px + width - 2, bottom);
  }

  private drawTownLandmarks(graphics: Phaser.GameObjects.Graphics): void {
    const trees: Array<[number, number]> = [[2, 3], [4, 3], [14, 4], [31, 3], [45, 4], [2, 27], [12, 33], [46, 25], [30, 30], [15, 2], [45, 30], [28, 34]];
    for (const [x, y] of trees) {
      const px = x * TOWN_TILE + 12;
      const py = y * TOWN_TILE + 13;
      graphics.fillStyle(0x2c4539, 1).fillCircle(px + 2, py + 4, 11);
      graphics.fillStyle(0x416742, 1).fillCircle(px - 3, py, 10).fillCircle(px + 6, py - 3, 9);
      graphics.fillStyle(0x6f8c54, 0.75).fillCircle(px - 5, py - 5, 4);
      graphics.fillStyle(0x5c4030, 1).fillRect(px - 2, py + 7, 5, 11);
    }
    // 市場のテントと井戸は、単一セルの施設ではなく広場の景観小物として扱う。
    graphics.fillStyle(0x6f7378, 1).fillCircle(24 * TOWN_TILE + 12, 18 * TOWN_TILE + 12, 12);
    graphics.lineStyle(2, 0xc1c7c7, 0.8).strokeCircle(24 * TOWN_TILE + 12, 18 * TOWN_TILE + 12, 8);
    for (const [x, color] of [[15, 0xbf6456], [30, 0x507bb0]] as Array<[number, number]>) {
      graphics.fillStyle(color, 1).fillTriangle(x * TOWN_TILE, 20 * TOWN_TILE, x * TOWN_TILE + 24, 20 * TOWN_TILE, x * TOWN_TILE + 12, 20 * TOWN_TILE - 15);
      graphics.fillStyle(0x6e4b34, 1).fillRect(x * TOWN_TILE + 3, 20 * TOWN_TILE, 18, 12);
    }
  }

  private drawTownNpcs(graphics: Phaser.GameObjects.Graphics): void {
    for (const poi of TOWN_POINTS) {
      const position = this.poiPosition(poi);
      const y = position.y + (poi.kind === "customer" ? 0 : 14);
      graphics.fillStyle(0x261f28, 0.5).fillEllipse(position.x, y + 9, 12, 4);
      graphics.fillStyle(poi.color, 1).fillRect(position.x - 4, y - 3, 8, 10);
      graphics.fillStyle(0xf0c8a2, 1).fillCircle(position.x, y - 7, 4);
      graphics.fillStyle(0x2d2630, 1).fillRect(position.x - 4, y - 11, 8, 4);
    }
  }

  private renderHud(): void {
    this.add.rectangle(PANEL_X + 62, MAP_H / 2, 128, MAP_H, 0x201a2a).setStrokeStyle(1, 0x9f855b);
    const hpWidth = Math.max(0, Math.floor((this.state.hp / this.state.maxHp) * 96));
    this.add.text(PANEL_X + 8, 14, "珍品商", { fontSize: "12px", color: "#ffe4a0" });
    this.add.text(PANEL_X + 8, 34, `HP ${this.state.hp}/${this.state.maxHp}`, { fontSize: "10px", color: "#f5ddd6" });
    this.add.rectangle(PANEL_X + 56, 50, 98, 7, 0x4c3741).setOrigin(0.5);
    this.add.rectangle(PANEL_X + 7 + hpWidth / 2, 50, hpWidth, 5, 0xbc5866).setOrigin(0.5);
    this.add.text(PANEL_X + 8, 65, `${this.state.gold}G`, { fontSize: "12px", color: "#f7cf75" });
    this.add.text(PANEL_X + 8, 84, `所持 ${currentBulk(this.state)}/12`, { fontSize: "10px", color: "#cdd8df" });
    this.add.text(PANEL_X + 8, 98, `帰還石 ${this.state.returnStones}`, { fontSize: "9px", color: "#b7d8e8" });
    this.add.text(PANEL_X + 8, 108, `煙玉 ${this.state.smokeBombs}`, { fontSize: "9px", color: "#d2b5e8" });
    this.add.text(PANEL_X + 8, 124, "受注中", { fontSize: "9px", color: "#bca7d8" });
    const quests = this.state.quests.filter((quest) => quest.status === "active").slice(0, 3);
    quests.forEach((quest, index) => this.add.text(PANEL_X + 8, 139 + index * 16, quest.title, { fontSize: "7px", color: "#eee5d1", wordWrap: { width: 110 } }));
    this.add.rectangle(MAP_W / 2, 323, MAP_W, 72, 0x17131e).setStrokeStyle(1, 0x78624b);
    this.add.text(10, 301, this.state.message, { fontSize: "9px", color: "#f6ecd5", wordWrap: { width: 485, useAdvancedWrap: true } });
    const hint = this.state.location === "town" ? "Enter: 話す  I:持ち物  Q:依頼  H:操作" : "Enter: 拾う/階段  Z:煙玉  R:帰還  I:持ち物";
    this.add.text(10, 342, hint, { fontSize: "8px", color: "#ad9eb1" });
  }

  private renderModal(): void {
    const modal = this.modal;
    if (!modal) return;
    this.add.rectangle(320, 180, 530, 276, 0x0c0a11, 0.88).setStrokeStyle(2, 0xd4af72);
    this.add.text(71, 56, modal.title, { fontSize: "15px", color: "#ffe8ab" });
    modal.body.forEach((line, index) => this.add.text(71, 82 + index * 15, line, { fontSize: "9px", color: "#e8e0d1", wordWrap: { width: 490 } }));
    const choiceStart = Math.max(154, 88 + modal.body.length * 15 + 12);
    modal.choices.slice(0, 9).forEach((choice, index) => {
      const selected = index === modal.index;
      const color = choice.disabled ? "#71697a" : selected ? "#16121b" : "#e7ddc9";
      if (selected) this.add.rectangle(315, choiceStart + index * 16, 470, 14, 0xb07a50);
      this.add.text(82, choiceStart - 5 + index * 16, `${selected ? "▶" : "　"}${choice.label}`, { fontSize: "9px", color });
    });
    this.add.text(71, 302, "↑↓ 選択　Enter 決定　Esc 戻る", { fontSize: "8px", color: "#a89cad" });
  }
}
