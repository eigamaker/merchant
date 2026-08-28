/**
 * 冒険者の名前を組み合わせで作る。
 *
 * 以前は完成した氏名を12個だけ持ち、衝突したら通し番号を足していた。名簿を使い捨て
 * にしていたころは足りたが、全員が町に住み続けるようになると「デイン・クロウ 267」の
 * ような名前が並んでしまう。名と姓に分けて掛け合わせれば、同じ語感のまま数が尽きない。
 */

/** 名。既存12名の名の部分をそのまま含む。 */
export const GIVEN_NAMES = [
  "アロン", "セリア", "デイン", "エルナ", "フェン", "ギルダ",
  "ヒューゴ", "イリス", "ヨラン", "カラ", "レオン", "ノラ",
  "マレン", "オルド", "テッサ", "ブラン", "ユルグ", "サーシャ",
  "コルム", "ネリー", "ダグ", "ヴェラ", "ロイス", "ミレイ",
] as const;

/** 姓。既存12名の姓の部分をそのまま含む。 */
export const SURNAMES = [
  "ヴェイル", "ハート", "クロウ", "フォード", "グレイ", "ルーン",
  "マーシュ", "パイク", "ムーン", "アッシュ", "フリント", "ソーン",
  "ベルク", "ヘイズ", "ロウェル", "ダスク", "ケルン", "ブライア",
  "ストーン", "ヴァント", "リード", "ハロウ", "ウェイン", "オーグ",
] as const;

/** 作れる氏名の総数。名簿の上限より十分に大きいことを前提にしている。 */
export const NAME_COMBINATIONS = GIVEN_NAMES.length * SURNAMES.length;

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

function nameAt(index: number): string {
  const slot = ((index % NAME_COMBINATIONS) + NAME_COMBINATIONS) % NAME_COMBINATIONS;
  return `${GIVEN_NAMES[slot % GIVEN_NAMES.length]}・${SURNAMES[Math.floor(slot / GIVEN_NAMES.length)]}`;
}

/**
 * キャンペーンと通し番号から氏名を決める。
 *
 * 同じ入力なら必ず同じ名前になる。既に使われていれば組み合わせ空間を1つずつ進めて
 * 空きを探す（先に名が変わり、24個進むと姓が変わる）。通し番号は決して名前に混ぜない。
 */
export function generateNpcName(campaignId: string, serial: number, taken: ReadonlySet<string> = new Set()): string {
  const start = hash(`${campaignId}:name:${serial}`) % NAME_COMBINATIONS;
  for (let step = 0; step < NAME_COMBINATIONS; step += 1) {
    const candidate = nameAt(start + step);
    if (!taken.has(candidate)) return candidate;
  }
  // 名簿が576人を超えない限り到達しない。到達しても番号は足さず、重複を許す。
  return nameAt(start);
}
