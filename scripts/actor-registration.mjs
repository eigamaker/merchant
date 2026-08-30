/**
 * Turning a plain sprite sheet into a character.
 *
 * The importer only recognises an actor when a TMX points at it, so a pack that
 * ships loose PNGs lands entirely in the tile folder: its people are visible in
 * the palette and invisible to the character list. Rather than guess harder at
 * import time, this lets an author say "this sheet is a walk cycle" once and
 * writes the same `actor.json` the importer would have written.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

export const ACTOR_MANUAL_DIR = path.resolve("assets-src/actors/imported/manual");
export const ACTOR_REGISTER_API = "/__map-editor/actors/register";

/** Mirrors ActorAction in src/game/craftpixActors.ts. */
export const ACTOR_ACTIONS = ["idle", "walk", "run", "attack", "walkAttack", "runAttack", "hurt", "death"];
/** Mirrors ActorRole in src/game/actorSettings.ts. */
export const ACTOR_ROLES = ["player", "npc", "enemy", "townsfolk", "adventurer"];
/**
 * Which facing each row holds. The packs do not agree, so the author picks:
 * monster sheets run front, back, then the sides; human sheets put the sides in
 * the middle and the back last. Mirrors MONSTER/HUMAN_DIRECTION_ROWS in
 * src/game/craftpixActors.ts.
 */
export const MONSTER_DIRECTION_ROWS = ["down", "up", "left", "right"];
export const HUMAN_DIRECTION_ROWS = ["down", "left", "right", "up"];
export const ACTOR_DIRECTIONS = MONSTER_DIRECTION_ROWS;

/** Whether a row order names each of the four facings exactly once. */
export function isDirectionRowOrder(value) {
  return Array.isArray(value) && value.length === 4 && new Set(value).size === 4 && value.every((direction) => ACTOR_DIRECTIONS.includes(direction));
}
export const ACTOR_SHEET_ROWS = 4;

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const DEFAULT_FRAME_RATE = 8;

/**
 * The frame grid a four-row character sheet implies: the rows are the four
 * facings, so a row's height is one frame, and square frames divide the width
 * into columns. Sheets that do not divide cleanly get no guess and the author
 * types the numbers instead.
 */
export function guessSheetGeometry(width, height, rows = ACTOR_SHEET_ROWS) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return undefined;
  if (rows < 1 || height % rows !== 0) return undefined;
  const frameHeight = height / rows;
  if (width % frameHeight !== 0) return undefined;
  return { frameWidth: frameHeight, frameHeight, columns: width / frameHeight, rows };
}

function assertGeometry(png, { frameWidth, frameHeight, columns }, sheetLabel) {
  for (const [name, value] of Object.entries({ frameWidth, frameHeight, columns })) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name}は1以上の整数で指定してください`);
  }
  if (columns * frameWidth !== png.width) throw new Error(`${sheetLabel}: 列数×コマ幅が画像の幅と一致しません（${columns}×${frameWidth} ≠ ${png.width}）`);
  if (ACTOR_SHEET_ROWS * frameHeight !== png.height) throw new Error(`${sheetLabel}: ${ACTOR_SHEET_ROWS}行×コマ高が画像の高さと一致しません（${ACTOR_SHEET_ROWS}×${frameHeight} ≠ ${png.height}）`);
}

function readDefinition(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Adds one action to a hand-registered character, creating it on first use.
 *
 * `sourceFile` is resolved by the caller from an asset id rather than sent by
 * the browser, so a request can never name a path outside the asset folder.
 */
export function registerActorClip(request, { manualDir = ACTOR_MANUAL_DIR } = {}) {
  const { id, label, roles, action, sourceFile, directions = MONSTER_DIRECTION_ROWS, sheetLabel = path.basename(String(sourceFile ?? "")) } = request ?? {};
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("IDは英小文字で始まる a-z 0-9 . _ - のみです");
  if (typeof label !== "string" || !label.trim()) throw new Error("表示名を入力してください");
  if (!ACTOR_ACTIONS.includes(action)) throw new Error(`動作が不正です: ${String(action)}`);
  const chosenRoles = Array.isArray(roles) && roles.length ? [...new Set(roles)] : ["npc"];
  for (const role of chosenRoles) if (!ACTOR_ROLES.includes(role)) throw new Error(`役割が不正です: ${String(role)}`);
  if (!isDirectionRowOrder(directions)) throw new Error(`行の並びが不正です: ${JSON.stringify(directions)}`);
  if (typeof sourceFile !== "string" || !fs.existsSync(sourceFile)) throw new Error("素材シートが見つかりません");

  const png = PNG.sync.read(fs.readFileSync(sourceFile));
  const guess = guessSheetGeometry(png.width, png.height);
  const frameWidth = request.frameWidth ?? guess?.frameWidth;
  const frameHeight = request.frameHeight ?? guess?.frameHeight;
  const columns = request.columns ?? guess?.columns;
  if (frameWidth === undefined || frameHeight === undefined || columns === undefined) {
    throw new Error(`${sheetLabel}: ${png.width}x${png.height} からコマ割りを推定できません。コマ幅・コマ高・列数を指定してください`);
  }
  assertGeometry(png, { frameWidth, frameHeight, columns }, sheetLabel);

  const frameRate = Number(request.frameRate ?? DEFAULT_FRAME_RATE);
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 60) throw new Error("コマ送り速度は0より大きく60以下で指定してください");

  const actorDir = path.join(manualDir, id);
  fs.mkdirSync(actorDir, { recursive: true });
  fs.copyFileSync(sourceFile, path.join(actorDir, `${action}.png`));

  const definitionFile = path.join(actorDir, "actor.json");
  const existing = readDefinition(definitionFile);
  const definition = {
    version: 1,
    id,
    label: label.trim(),
    roles: chosenRoles,
    clips: {
      ...(existing?.clips ?? {}),
      [action]: {
        action,
        path: path.relative(path.resolve("assets-src/actors"), path.join(actorDir, `${action}.png`)).replaceAll("\\", "/"),
        width: png.width,
        height: png.height,
        frameWidth,
        frameHeight,
        columns,
        rows: ACTOR_SHEET_ROWS,
        directions: [...directions],
        frameRate,
      },
    },
    scale: existing?.scale ?? 1,
    origin: existing?.origin ?? { x: 0.5, y: 0.72 },
    ...(existing?.enemyStats ? { enemyStats: existing.enemyStats } : {}),
  };
  fs.writeFileSync(definitionFile, JSON.stringify(definition, null, 2) + "\n", "utf8");
  return definition;
}

/** Drops a hand-registered character. Only the manual folder is ever touched. */
export function removeRegisteredActor(id, { manualDir = ACTOR_MANUAL_DIR } = {}) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("IDが不正です");
  const actorDir = path.join(manualDir, id);
  if (!actorDir.startsWith(manualDir + path.sep)) throw new Error("IDが不正です");
  if (!fs.existsSync(actorDir)) throw new Error(`登録されていません: ${id}`);
  fs.rmSync(actorDir, { recursive: true, force: true });
  return id;
}

/** The ids registered by hand, so the editor can offer them for editing. */
export function registeredActorIds({ manualDir = ACTOR_MANUAL_DIR } = {}) {
  if (!fs.existsSync(manualDir)) return [];
  return fs.readdirSync(manualDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(manualDir, entry.name, "actor.json")))
    .map((entry) => entry.name)
    .sort();
}
