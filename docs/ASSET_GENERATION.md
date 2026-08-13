# 生成AI向けアセット制作指示

更新日: 2026-08-13

この文書は画像生成AIへ渡す依頼文と、生成後の受入手順をまとめたものです。最終的なファイル寸法とセル座標は [ASSET_SPEC.md](ASSET_SPEC.md) が優先されます。

## 1. モデル方針

APIから新規生成する場合は `gpt-image-2-2026-04-21` を固定候補とします。OpenAIの現行モデルページではGPT Image 2が既定の画像生成モデルとして案内され、固定スナップショットも公開されています。[GPT Image 2公式仕様](https://developers.openai.com/api/docs/models/gpt-image-2)

`gpt-image-1-mini` は非推奨のため、新規制作では使いません。既存成果物の再現に必要な場合だけ、生成履歴へ`legacy`として記録します。[gpt-image-1-mini公式仕様](https://developers.openai.com/api/docs/models/gpt-image-1-mini)

Codex内蔵の画像生成を使う場合は、実際に利用された経路をメタデータへ記録し、APIモデルIDを推測して書きません。ゲームはモデル名に依存せず、最終PNGの契約だけに依存します。

## 2. 1回の依頼単位

1回の生成で町全体や、無関係な複数カテゴリを作らせません。次のいずれか1つに限定します。

- 4×3セルの小型建物1棟
- 8×3セルの大型建物1棟
- 1キャラクターの4方向原画
- 同カテゴリNPCまたは敵の方向グリッド
- 地形1バンク16種
- 壁15種
- 同用途の小物セット

生成結果は**デザイン原画**です。AI出力をそのままランタイムへ置かず、クロマキー除去、切り出し、最近傍縮小、寸法検査を行います。

## 3. 全依頼に付ける共通指示

```text
Use case: stylized-concept
Asset type: 2D top-down fantasy RPG pixel-art game asset
Primary request: [対象を1種類だけ記載]
Style/medium: detailed but readable pixel art, top-down three-quarter view
Lighting: consistent light from upper-left, short shadow to lower-right
Palette: warm wood, muted stone and soil, subdued grass, restrained blue-green accents
Backdrop: perfectly flat solid #FF00FF chroma-key background
Constraints: no text, no logo, no UI, no watermark, no frame, no grid lines, no scenery outside the requested asset; crisp pixel clusters; no antialiasing; no smooth gradients; generous padding; do not use #FF00FF in the subject
```

視点は見下ろし寄りの3/4ビューに統一します。アイソメトリック、真正面図、強い遠近法、写真風レンダリングは禁止します。

## 4. キャラクター用指示

### 単体キャラクター

```text
Create one consistent character as an exact horizontal four-cell direction atlas.
Cell order from left to right: facing down/front, facing left, facing right, facing up/back.
The four poses must depict the same person, outfit, equipment, palette, head size, body scale, and total character height.
Side-facing poses must not be larger than front or back poses.
Align every pose to the same foot baseline and keep equal head-to-foot height; only silhouette width may naturally differ.
Left and right must be genuine side profiles. The up pose must be a genuine back view with no visible face or chest.
Neutral standing pose; no attack pose; no cast shadow; no labels or dividers.
```

#### 主人公

```text
Subject: a young traveling curio merchant with auburn hair, a muted red cloak, leather boots, belt pouches, satchel and a small lantern.
Identity constraints: preserve the merchant silhouette and equipment in all four directions; the satchel changes visible side naturally with perspective but does not change size.
```

#### ロルフ

```text
Subject: a young auburn-haired standard swordsman, steel breastplate, rust-red tunic, buckler and sheathed sword.
Identity constraints: same armor proportions and body height in all directions; no drawn attack motion.
```

#### ミナ

```text
Subject: a dark braided scout with a teal hood, moss-colored leather jerkin, satchel and dagger.
Identity constraints: same hood, braid, body height and equipment scale in all directions; no drawn attack motion.
```

### 複数キャラクターの入力グリッド

変換スクリプトが受け取る透過済み原画の順序です。

| 入力 | グリッド | 並び |
| --- | --- | --- |
| 主人公 | 4×1 | 下、左、右、上 |
| 護衛1人 | 4×1 | 下、左、右、上 |
| NPC | 5×4 | 列=役割、行=下・左・右・上 |
| 敵 | 6×4 | 列=種類、行=下・左・右・上 |

方向ごとの全高が揃っていない画像は受け入れません。クロマキー除去後に外周へ色が残ると縮尺判定を誤るため、セル境界へキャラクターを接触させないでください。

## 5. 建物用指示

### 4×3セル建物

```text
Create one continuous [施設名] building module that will become exactly 96×72 pixels, 4×3 cells on a 24-pixel grid.
Design the whole building first, without visible tile divisions.
Continuous roof across the upper area; coherent wall, windows and sign in the middle; foundation and exactly one entrance near the lower center.
Roof tiles, beams, wall patterns and shadow must continue across hidden cell boundaries.
Do not make four small buildings or four icon tiles.
[配色と施設固有要素]
```

### 8×3セル建物

```text
Create one continuous wide [施設名] building that will become exactly 192×72 pixels, 8×3 cells on a 24-pixel grid.
It is one building, not two attached buildings.
There must be no seam, vertical divider, second roof edge, repeated entrance or color change at the center.
Use one continuous roof and facade, with exactly one entrance near the lower center.
[配色と施設固有要素]
```

建物の外側に歩道や庭を描き込みません。敷地、柵、入口前の道はマップ側で構成します。

## 6. 地形用指示

```text
Create one 16-frame cardinal-connectivity terrain bank for [草地／土の道／石畳／水際／桟橋].
The final bank is one horizontal row of sixteen 24×24 pixel cells.
Frame column equals connectivity mask using N=1, E=2, S=4, W=8, from mask 0 through mask 15.
Every connection must meet the exact center of the corresponding cell edge.
Keep edge colors, path width, shoreline position and texture scale consistent across all frames.
No grid lines, gaps, labels or frame numbers.
```

地形中央は低コントラストにし、接続境界だけを明確にします。16種を単なる色違いにせず、接続マスクとして成立させます。

## 7. ダンジョン壁用指示

```text
Create one coherent dungeon wall set with exactly 15 required variants in this order:
center; north/east/south/west exposed edges; outer corners NE/SE/SW/NW; inner corners NE/SE/SW/NW; one pillar; one cracked wall.
Use the same blue-gray stone material, wall height, mortar scale, upper-left light and lower-right shadow in all variants.
The set will be placed into 24×24 cells. Connection points must align at cell edges.
No blood, text, characters, strong glow or unrelated props.
```

最終配置は `ASSET_SPEC.md` のframe 0〜14に従います。

## 8. 柵・敷地小物用指示

```text
Create a coherent village prop set containing a straight wooden fence, fence corner, one-cell gate, broadleaf tree, pine tree, shrub, barrel, crates, market stall, sign, wheat and a small boat.
Each prop must remain readable when reduced to a 24×24 cell.
Fence rail height and post positions must match between fence pieces.
The gate opening must read as a one-cell passage.
No completed map, no building, no characters and no labels.
```

農地、家畜小屋、公爵邸の敷地は完成画像として生成せず、建物、柵、門、地形、小物をゲーム側で組み合わせます。

## 9. 変換と記録

1. 原画を `assets-src/*-source.png` として保存する。
2. `#FF00FF`を透過に変換し、`assets-src/*-alpha.png` として保存する。
3. 透明四隅、色残り、対象の欠損を確認する。
4. `python scripts/build_game_assets.py` で最終PNGを作る。
5. `npm test` と `npm run build` を実行する。

生成ごとに次をJSONへ残します。

```json
{
  "model": "実際に利用したモデルまたは生成経路",
  "prompt": "最終プロンプト全文",
  "source_image": "参照画像があればパス",
  "grid": "4x1: down,left,right,up",
  "chroma_key": "#FF00FF",
  "processed_at": "YYYY-MM-DD"
}
```

## 10. AI出力の受入チェック

- 指定外の文字、罫線、背景、小物、影がない。
- 同一人物・同一建物として方向間・セル間の一貫性がある。
- キャラクター4方向の頭身と全高が一致し、横向きだけ大きくない。
- 大型建物の中央に継ぎ目がない。
- 地形16種が0〜15のビット順に並んでいる。
- 壁が15種あり、内角4種を欠いていない。
- 最終24px／32px表示で読み取れる。
