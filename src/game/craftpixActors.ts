/**
 * Runtime-neutral actor definitions for the supplied Craftpix character packs.
 *
 * Each action sheet is kept separate because the source packs use a different
 * number of frames per action. The importer records the exact dimensions and
 * the renderer creates the animation from this manifest.
 */

export type ActorAction = "idle" | "walk" | "run" | "attack" | "walkAttack" | "runAttack" | "hurt" | "death";
export type ActorDirection = "down" | "left" | "right" | "up";

export interface CraftpixActorClip {
  action: ActorAction;
  path: string;
  /** Optional source-sheet metadata emitted by the TMX importer. */
  width?: number;
  height?: number;
  tileSize?: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: 4;
  /** The source sheets are four directional rows; this is explicit metadata. */
  directions: readonly ActorDirection[];
  frameRate: number;
  repeat?: number;
  durationsMs?: readonly number[];
}

export interface CraftpixActorDefinition {
  version?: number;
  id: string;
  label: string;
  sourcePack?: string;
  clips: Partial<Record<ActorAction, CraftpixActorClip>>;
  scale: number;
  origin: { x: 0.5; y: number };
  roles?: readonly ("player" | "npc" | "enemy")[];
  enemyStats?: { baseHp: number; hpPerFloor: number; damage: number };
}

const directions = ["down", "left", "right", "up"] as const;
const clip = (action: ActorAction, path: string, columns: number, frameRate: number, repeat = -1, frameWidth = 64, frameHeight = 64): CraftpixActorClip => ({
  action,
  path,
  frameWidth,
  frameHeight,
  columns,
  rows: 4,
  directions,
  frameRate,
  repeat,
});

type ActorColumns = Partial<Record<"idle" | "walk" | "run" | "attack" | "walkAttack" | "runAttack" | "hurt" | "death", number>>;

function characterSet(prefix: string, folder: string, sourcePack: string, columns: ActorColumns, roles: readonly ("player" | "npc" | "enemy")[] = ["enemy"]): CraftpixActorDefinition {
  const uppercaseActions = prefix.startsWith("Swordsman") || prefix.startsWith("Slime") || prefix.startsWith("Plant") || prefix.startsWith("Vampires");
  const file = (action: string): string => {
    const names: Record<string, string> = uppercaseActions
      ? { idle: "Idle", walk: "Walk", run: "Run", attack: "Attack", walkAttack: "Walk_Attack", runAttack: "Run_Attack", hurt: "Hurt", death: "Death" }
      : { idle: "idle", walk: "walk", run: "run", attack: "attack", hurt: "hurt", death: "death" };
    const actionName = prefix.startsWith("Swordsman") && action === "attack" ? "attack" : (names[action] ?? action);
    return `assets/actors/craftpix/${folder}/${prefix}_${actionName}_with_shadow.png`;
  };

  const clips: Partial<Record<ActorAction, CraftpixActorClip>> = {
    idle: clip("idle", file("idle"), columns.idle ?? 4, 5),
    walk: clip("walk", file("walk"), columns.walk ?? 6, 8),
    run: clip("run", file("run"), columns.run ?? 8, 10),
    attack: clip("attack", file("attack"), columns.attack ?? 8, 12, 0),
    hurt: clip("hurt", file("hurt"), columns.hurt ?? 5, 8, 0),
    death: clip("death", file("death"), columns.death ?? 7, 8, 0),
  };
  if (prefix.startsWith("Swordsman")) {
    clips.walkAttack = clip("walkAttack", file("walkAttack"), columns.walkAttack ?? 6, 12, 0);
    clips.runAttack = clip("runAttack", file("runAttack"), columns.runAttack ?? 8, 12, 0);
  }

  return {
    id: folder.toLowerCase(),
    label: folder,
    sourcePack,
    clips,
    // The visible character occupies roughly 20–27px inside a 64px source
    // cell. Render at native scale and anchor the feet to the shadow.
    scale: 1,
    origin: { x: 0.5, y: 0.72 },
    roles,
    enemyStats: roles.includes("enemy") ? { baseHp: prefix.startsWith("Slime") ? 3 : prefix.startsWith("Vampires") ? 2 : 4, hpPerFloor: 1, damage: prefix.startsWith("Slime") || prefix.startsWith("Vampires") ? 1 : 2 } : undefined,
  };
}

function merchantProtagonistSet(): CraftpixActorDefinition {
  const idlePath = "assets/actors/craftpix/MerchantProtagonist/MerchantProtagonist_Idle_with_shadow.png";
  const walkPath = "assets/actors/craftpix/MerchantProtagonist/MerchantProtagonist_Walk_with_shadow.png";
  return {
    id: "merchant-protagonist",
    label: "MerchantProtagonist",
    sourcePack: "provided-character",
    clips: {
      // The supplied sheet has three authored frames per direction. Use the
      // first frame for idle and retain all three for walking.
      idle: clip("idle", idlePath, 1, 5, -1, 32, 32),
      walk: clip("walk", walkPath, 3, 8, -1, 32, 32),
    },
    scale: 1,
    origin: { x: 0.5, y: 0.72 },
    roles: ["player"],
  };
}

export const CRAFTPIX_PLAYER_ACTOR = merchantProtagonistSet();

/** The level 2/3 Swordsman sheets are human NPC variants, not enemies. */
export const CRAFTPIX_NPC_ACTORS = {
  swordsman_lvl1: characterSet("Swordsman_lvl1", "Swordsman_lvl1", "swordsman", { idle: 12, walk: 6, run: 8, attack: 8, walkAttack: 6, runAttack: 8, hurt: 5, death: 7 }, ["npc"]),
  swordsman_lvl2: characterSet("Swordsman_lvl2", "Swordsman_lvl2", "swordsman", { idle: 12, walk: 6, run: 8, attack: 8, walkAttack: 6, runAttack: 8, hurt: 5, death: 7 }, ["npc"]),
  swordsman_lvl3: characterSet("Swordsman_lvl3", "Swordsman_lvl3", "swordsman", { idle: 12, walk: 6, run: 8, attack: 8, walkAttack: 6, runAttack: 8, hurt: 5, death: 7 }, ["npc"]),
} as const;

export type CraftpixNpcActorId = keyof typeof CRAFTPIX_NPC_ACTORS;

export const CRAFTPIX_ENEMY_ACTORS = {
  slime1: characterSet("Slime1", "Slime1", "slimes", { idle: 6, walk: 8, run: 8, attack: 10, hurt: 5, death: 10 }),
  slime2: characterSet("Slime2", "Slime2", "slimes", { idle: 6, walk: 8, run: 8, attack: 11, hurt: 5, death: 10 }),
  slime3: characterSet("Slime3", "Slime3", "slimes", { idle: 6, walk: 8, run: 8, attack: 9, hurt: 5, death: 10 }),
  plant1: characterSet("Plant1", "Plant1", "predator-plants", { idle: 4, walk: 6, run: 8, attack: 7, hurt: 5, death: 10 }),
  plant2: characterSet("Plant2", "Plant2", "predator-plants", { idle: 4, walk: 6, run: 8, attack: 7, hurt: 5, death: 10 }),
  plant3: characterSet("Plant3", "Plant3", "predator-plants", { idle: 4, walk: 6, run: 8, attack: 7, hurt: 5, death: 10 }),
  orc1: characterSet("orc1", "Orc1", "orcs", { idle: 4, walk: 6, run: 8, attack: 8, hurt: 6, death: 8 }),
  orc2: characterSet("orc2", "Orc2", "orcs", { idle: 4, walk: 6, run: 8, attack: 8, hurt: 6, death: 8 }),
  orc3: characterSet("orc3", "Orc3", "orcs", { idle: 4, walk: 6, run: 8, attack: 8, hurt: 6, death: 8 }),
  vampire1: characterSet("Vampires1", "Vampires1", "vampires", { idle: 4, walk: 6, run: 8, attack: 12, hurt: 4, death: 11 }),
  vampire2: characterSet("Vampires2", "Vampires2", "vampires", { idle: 4, walk: 6, run: 8, attack: 12, hurt: 4, death: 11 }),
  vampire3: characterSet("Vampires3", "Vampires3", "vampires", { idle: 4, walk: 6, run: 8, attack: 12, hurt: 4, death: 11 }),
} as const;

export type CraftpixEnemyActorId = keyof typeof CRAFTPIX_ENEMY_ACTORS;

export const CRAFTPIX_ENEMY_POOLS = {
  outdoor: ["slime1", "slime2", "plant1"] as const,
  shallow: ["slime1", "slime2", "orc1"] as const,
  middle: ["orc1", "orc2", "plant2", "vampire1"] as const,
  deep: ["orc3", "plant3", "vampire2", "vampire3"] as const,
};

export const CRAFTPIX_ACTORS = {
  player: CRAFTPIX_PLAYER_ACTOR,
  ...CRAFTPIX_NPC_ACTORS,
  ...CRAFTPIX_ENEMY_ACTORS,
} as const;

export function craftpixActor(id: string): CraftpixActorDefinition | undefined {
  return CRAFTPIX_ACTORS[id as keyof typeof CRAFTPIX_ACTORS];
}

export function actorFrame(action: CraftpixActorClip, direction: ActorDirection, frame: number): number {
  const row = action.directions.indexOf(direction);
  if (row < 0) throw new RangeError(`unknown actor direction: ${direction}`);
  if (!Number.isInteger(frame) || frame < 0 || frame >= action.columns) throw new RangeError(`actor frame out of range: ${frame}`);
  return row * action.columns + frame;
}
