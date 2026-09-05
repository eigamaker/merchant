# 家用モジュラータイル素材

家も既存の `MapDocument` とマニュアルマップエディターを使用する。完成した部屋の絵を分割した `home.merchant-room` は廃止した。既定の家は通常の assetId / frame を各レイヤーに保存している。

## 素材と配置

- ground: 繰り返し使える木の床。
- structure: 壁4種（漆喰・上梁・側壁・下壁）、通行できるカーペット。
- decoration: 商品棚、ベッド、宝箱、テーブル、カウンター、樽、箱、ドア、スツール、準備机、ランタン。家具は床を含まない透過PNG。
- 通行判定: 固形家具は不可、カーペットとドアは可。ランタンは壁に取り付けるため不可。

カーペットと家具は異なるレイヤーなので重ねて置ける。家専用の背景描画処理や新しいマップ形式は追加していない。

## マニュアル編集

`review.html` のマニュアルマップで家を選び、「家・基本」から床と壁を配置する。「家・家具（範囲選択で一括配置）」で家具全体を矩形選択し、パレット属性で配置する。同じ家具を何度でも配置できる。ドアは壁に開口部を作った上で置く。家具を移動・消去する際には、そのレイヤーと通行判定を編集する。

家具パレットの左上座標とサイズ（16pxタイル単位）:

| 素材 | 左上 x,y | 幅×高さ |
|---|---|---|
| 商品棚 | 0,0 | 3×2 |
| ベッド | 4,0 | 2×3 |
| 宝箱 | 7,0 | 2×1 |
| テーブル | 10,0 | 2×2 |
| カーペット | 0,4 | 4×3 |
| カウンター | 5,4 | 4×2 |
| 樽 | 10,4 | 1×2 |
| 箱 | 12,4 | 1×1 |
| ドア | 0,8 | 2×2 |
| スツール | 3,8 | 1×1 |
| 準備机 | 5,8 | 2×1 |
| ランタン | 8,8 | 1×1 |

## 再生成

原本は `assets-src/home-interior/merchant-furniture-original.png`。内蔵 image_gen に前回の室内を参考画像として渡し、独立した家具アトラスを生成した。生成画像は不透明のチェッカー背景だったため、変換時に無彩色の背景を除去して本当のアルファに変換している。木の床・壁は `merchant-room-original.png` の家具を含まない領域から独立素材として切り出した。

`node scripts/build-home-interior.mjs` は `assets-src/map-tiles/sheets/merchant/` のPNGとtileset.json、家用パレットを再生成する。手作業で編集する既定マップは上書きしない。`npm run assets` は通常のパイプラインで `public/assets/map-tiles/generated/home.merchant-*.png` とカタログを生成する。

## 内蔵 image_gen に渡したプロンプト

Edit this reference into a production modular sprite atlas, NOT a room image. Preserve its warm walnut/teal/burgundy classic top-down JRPG pixel-art furniture design. Output exactly 1024x1024 transparent PNG. Four columns and four rows of equal 256x256 cells. Each object wholly inside its own cell with generous transparent margins, no background floor, no ground shadows, no contact with other cells, no grid lines, no labels or text. Crisp nearest-neighbor pixel art with 4px square pixel clusters, orthographic top down with visible front faces like the reference. Cell order row-major: row 1: stocked book-and-potion wooden shelf; teal bed with pillow; closed brass-trimmed treasure chest; round wooden dining table with cup. Row 2: rectangular burgundy rug with gold border seen directly overhead; long horizontal shop counter with ledger and brass scales; single upright barrel; single wooden shipping crate. Row 3: open wooden double door with frame, black doorway must be transparent; small wooden stool; preparation desk with open book and mortar; warm wall lantern. Row 4: empty (transparent); empty; empty; empty. All 12 objects isolated alpha cutouts. No walls or room. Furniture reusable on ANY floor. Objects framed individually centered in exact equal cells, keep rugs and furniture full silhouettes including all feet. No photorealism or blur.
