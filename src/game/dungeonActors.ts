import { NPC_APPEARANCES } from "./merchantContent";
import type { GameState } from "./types";

/**
 * 迷宮に立っている者の見た目を引く。
 *
 * 要点はひとつ —— **名簿の人物を敵として引き当ててはならない。**
 * 同行している冒険者は主人公でも護衛でもないので、敵の表から引くと
 * IDのハッシュでモンスターが1体当たってしまい、攻撃や被弾の瞬間に
 * その動きへ化ける。人が一瞬スライムやオークになるのはこれである。
 *
 * 見つからないIDには何も返さない。動きを付けないほうが、
 * 別人の動きを付けるよりはるかにましだからである。
 */
export function dungeonActorAppearance(state: GameState, id: string): string | undefined {
  if (id === "player") return "player";
  const npc = state.npcs.find((entry) => entry.id === id);
  if (npc) return NPC_APPEARANCES[npc.appearanceId];
  const enemy = state.run?.enemies.find((entry) => entry.id === id);
  return enemy?.actorId;
}
