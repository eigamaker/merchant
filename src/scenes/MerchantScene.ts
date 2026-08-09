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

type PointOfInterest = {
  id: string;
  name: string;
  pos: Vec;
  kind: "shop" | "guild" | "tavern" | "entrance" | "customer";
  customerId?: string;
  color: number;
};

const POIS: PointOfInterest[] = [
  { id: "shop", name: "珍品店", pos: { x: 5, y: 5 }, kind: "shop", color: 0xdca65a },
  { id: "tavern", name: "酒場", pos: { x: 10, y: 2 }, kind: "tavern", color: 0xc87762 },
  { id: "guild", name: "冒険者ギルド", pos: { x: 16, y: 3 }, kind: "guild", color: 0x73a4c2 },
  { id: "entrance", name: "ダンジョン入口", pos: { x: 2, y: 9 }, kind: "entrance", color: 0x687890 },
  { id: "duke", name: "ローデン公爵", pos: { x: 14, y: 9 }, kind: "customer", customerId: "duke", color: 0xb9a5eb },
  { id: "scholar", name: "エリス研究室", pos: { x: 18, y: 8 }, kind: "customer", customerId: "scholar", color: 0xf0cf83 },
  { id: "mage", name: "ネヴァ魔術店", pos: { x: 7, y: 10 }, kind: "customer", customerId: "mage", color: 0x92b8ea },
  { id: "jeweler", name: "サフィ宝石商", pos: { x: 11, y: 10 }, kind: "customer", customerId: "jeweler", color: 0xe58eb1 },
  { id: "merchant", name: "ミラ道具店", pos: { x: 2, y: 5 }, kind: "customer", customerId: "merchant", color: 0x8fc6a5 },
];

function same(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

function distance(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export class MerchantScene extends Phaser.Scene {
  private state: GameState = createNewGame();
  private modal?: Modal;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly saves = new SaveRepository();
  private gameStarted = false;
  private lastAutoSaveAt = Number.NEGATIVE_INFINITY;

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
      const radius = 10;
      const next = {
        x: Phaser.Math.Clamp(this.state.townPos.x + (horizontal / length) * speed * (delta / 1000), radius, MAP_W - radius),
        y: Phaser.Math.Clamp(this.state.townPos.y + (vertical / length) * speed * (delta / 1000), radius, MAP_H - radius),
      };
      this.state.townPos = next;
      moved = true;
    }
    if (this.just("enter") || this.just("space")) this.interactTown();
    if (this.just("i")) this.openInventory();
    if (this.just("l")) this.openLedger();
    if (this.just("q")) this.openQuestBoard();
    if (this.just("h")) this.openHelp();
    if (this.just("f1")) void this.saveManual("manual-1");
    if (this.just("f2")) void this.saveManual("manual-2");
    if (this.just("f3")) void this.saveManual("manual-3");
    if (moved || this.just("enter") || this.just("space") || this.just("i") || this.just("l") || this.just("q") || this.just("h")) this.render();
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
    const poi = POIS.find((entry) => distance(this.poiPosition(entry), this.state.townPos) <= 30);
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

  private poiPosition(poi: PointOfInterest): Vec {
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
    this.add.rectangle(MAP_W / 2, MAP_H / 2, MAP_W, MAP_H, 0x31514b);
    for (let y = 0; y < GRID_H; y += 1) {
      for (let x = 0; x < GRID_W; x += 1) {
        const road = y === 6 || x === 9 || (x > 2 && x < 19 && y === 9);
        this.add.rectangle(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE - 1, TILE - 1, road ? 0x8c7a5b : 0x416754);
      }
    }
    for (const poi of POIS) {
      this.add.rectangle(poi.pos.x * TILE + TILE / 2, poi.pos.y * TILE + TILE / 2, 22, 22, poi.color, poi.kind === "entrance" ? 0.65 : 1).setStrokeStyle(1, 0x251d25);
      this.add.text(poi.pos.x * TILE + 12, poi.pos.y * TILE - 10, poi.name, { fontSize: "6px", color: "#fff2d7", stroke: "#251d25", strokeThickness: 2 }).setOrigin(0.5);
    }
    this.add.image(this.state.townPos.x, this.state.townPos.y, ASSET_MANIFEST.player.textureKey);
    this.add.text(8, 8, `灰灯町 — ${this.state.day}日目`, { fontSize: "11px", color: "#fff2d7", stroke: "#1b1620", strokeThickness: 3 });
  }

  private renderDungeon(): void {
    const run = this.state.run;
    if (!run) return;
    for (let y = 0; y < run.map.height; y += 1) {
      for (let x = 0; x < run.map.width; x += 1) {
        const wall = run.map.tiles[y]![x] === 1;
        this.add.rectangle(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE - 1, TILE - 1, wall ? 0x342c3a : 0x6d5e52)
          .setStrokeStyle(1, wall ? 0x2a2330 : 0x807261);
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
