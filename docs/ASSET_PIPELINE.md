# アセット実装・変換パイプライン

更新日: 2026-08-13

この文書は、現在のリポジトリで何が実際に使われているか、原画をどうランタイムPNGへ変換するかを説明します。制作時の固定寸法は [ASSET_SPEC.md](ASSET_SPEC.md)、生成AIへ渡す指示は [ASSET_GENERATION.md](ASSET_GENERATION.md) を参照してください。

## 1. ディレクトリ

```text
assets-src/                 生成原画、参照画像、クロマキー除去済み中間素材
assets-src/town-map-source.png 町マップの原画1枚（1448×1086）
assets-src/environment-v001/ Asset Forge承認済みの24×24セルと来歴マニフェスト
public/assets/actors/       128×128pxの方向別キャラクターシート
public/assets/buildings/    4×3または8×3セルの連続建物PNG
public/assets/tiles/        24px地形、壁、町小物、建物アトラス
public/assets/objects/      アイテムとダンジョン小物
public/assets/preview/      レビュー用一覧画像、町マップの格子・当たり判定オーバーレイ
scripts/build_game_assets.py  原画から実行用PNGを作る決定的変換
scripts/build_town_map.py     町マップ原画の切り出しとレビュー画像生成
```

ゲーム側の参照先は次の3ファイルです。

- `src/game/assets.ts`: パス、フレーム寸法、アニメーション、小物フレーム
- `src/game/assetFrames.ts`: 地形バンク、壁15種、建物キット座標
- `src/game/townLayout.json`: 町の当たり判定マスク、施設footprint、入口、スポーン
- `src/game/townMap.ts`: 上記JSONの読み出しと移動判定

## 2. 再生成

Pillowが使えるPython環境で実行します。

```powershell
python scripts/build_game_assets.py
python scripts/build_town_map.py
npm test
npm run build
```

`build_town_map.py` は `town-map-source.png` を左右4px・上下3pxだけ切り落として1440×1080にし、256色へ量子化して `public/assets/tiles/town_map.png` を出力します。拡大縮小もリサンプルもしないので、絵は原画のままです。同時に2枚のレビュー画像を出力します。

- `public/assets/preview/town-map-grid.png` — 24px格子と座標ラベル。当たり判定を絵から読み取るための作業用
- `public/assets/preview/town-map-collision.png` — `townLayout.json` の判定を重ねたもの。赤が侵入不可、緑が通行可、黄枠が建物footprint、青枠が入口、白丸がスポーン

町の当たり判定を触ったら、ゲームを起動する前にこのオーバーレイで確認してください。

`build_game_assets.py` は最近傍補間を使用し、透過済み原画をセル内へ収めます。`assets-src/environment-v001/` の地形はマスク順を保ったままタウン8種・ダンジョン8種のバンクへ配置し、壁は通常石／墓石の2バンクへ配置します。壁セルに残る生成時の緑地プレビューは、ダンジョン地形へ重ねても矩形が見えないよう透明化します。キャラクターについては、クロマキー除去後にセル外周へ残った微小な色を縮尺判定へ含めないよう、外周を除外してから不透明領域を測ります。

## 3. 現在の入力原画

| カテゴリ | 透過済み入力 | 入力グリッド |
| --- | --- | --- |
| 主人公 | `player-directions-alpha.png` | 4×1 |
| NPC | `npc-directions-alpha.png` | 5×4 |
| 敵 | `enemy-directions-alpha.png` | 6×4 |
| ロルフ | `guard-rolf-directions-alpha.png` | 4×1 |
| ミナ | `guard-mina-directions-alpha.png` | 4×1 |
| 建物（未使用） | `town-buildings-alpha.png` | 3×2 |
| 町小物（未使用） | `town-props-alpha.png` | 4×3 |
| 町マップ | `town-map-source.png` | 切り出し前の1枚絵 |
| ダンジョン | `dungeon-environment-alpha.png` | 4×3 |

元のクロマキー画像は同名の `*-source.png` として保持します。方向生成の来歴は `assets-src/direction-generation-metadata.json` にあります。

## 4. 現行実装の利用状況

| 項目 | 状態 | 補足 |
| --- | --- | --- |
| 主人公・NPC・護衛 | 組み込み済み | 4方向、4歩行フレーム |
| 敵 | 組み込み済み | 表示中はゴブリン、コウモリ、リザードを主に使用 |
| 町マップ | 組み込み済み | 1枚絵を24pxで切り出し、恒等インデックスのタイルマップ1層として描画 |
| 町地形バンク | 未使用 | `town_terrain.png`。町の刷新で描画から外れたがバンク契約は維持 |
| ダンジョン地形 | 組み込み済み | Asset Forgeの8バンク×16マスク。階層1〜8をバンク0〜7へ対応 |
| ダンジョン壁 | 組み込み済み | 通常石はシート行0〜3、墓石は行4〜7。15種を接続状態から選択 |
| 建物単体PNG | 未使用 | 町の刷新で描画から外れた。ファイルは維持 |
| 建物アトラス | 未使用 | 同上。キット座標契約は `assetFrames.ts` に維持 |
| 町小物 | 未使用 | 柵・木・樽・露店は町マップの絵に含まれる |
| 農地・家畜区画 | 廃止 | 新しい町の絵には該当区画がない |
| アイテム | 仮実装あり | 先頭8フレームを品IDから選択。重要品専用絵は未追加 |
| ダンジョン小物 | 組み込み済み | 宝箱、階段、帰還、松明、瓦礫、骨、罠、壁小物 |

この表の「未統合」項目について、画像だけを先に既存フレームへ上書きしないでください。コード側の参照契約と同時に更新します。

## 5. 自動検査

`src/game/assetFiles.test.ts` は次を検査します。

- 必須PNGの存在（`town_map.png` は1440×1080・パレット形式）
- PNG形式、RGBA、キャンバス寸法
- キャラクターの4方向が別画像であること
- 主人公の4方向の不透明領域高が一致すること

`src/game/townLayout.test.ts` は次を検査します。

- 当たり判定が60×45文字で、`#`と`.`だけであること
- 外周が閉じていること
- 施設9件と旅商人のidが揃い重複しないこと
- 全footprintがグリッド内で、入口とスポーンが通行可であること

`src/game/townMap.test.ts` は、スポーンから全POIへ幅優先探索で到達できること、入口が建物矩形の外周1セル以内にあることを検査します。

`src/game/assetFrames.test.ts` は次を検査します。

- 地形が1行16フレーム、N=1/E=2/S=4/W=8であること
- 壁15種の座標が重複しないこと
- 4×3建物キットの領域が重複しないこと
- 8×3建物の左右領域が連続していること

## 6. 差し替え手順

1. 対象の固定契約を `ASSET_SPEC.md` で確認する。
2. 既存原画を残し、新しい `*-source.png` と生成メタデータを保存する。
3. クロマキー除去後の `*-alpha.png` を目視確認する。
4. 変換スクリプトでランタイムPNGを再構築する。
5. 32pxまたは24pxの100%表示で確認する。
6. テストと本番ビルドを通す。
7. ファイル名や座標を変更した場合は、コード・仕様・テストを同じ変更で更新する。

## 7. 次にアセット化する優先項目

1. 依頼品、認識票、古びた指輪などの専用アイテム画像
2. 墓所、湿地、古代床など階層別ダンジョンバンク
3. 町の前景レイヤー（木の梢や屋根の手前をプレイヤーより上に描く2層目）

これらは画像生成だけでは完了せず、フレーム参照とマップ配置も同時に実装する必要があります。
