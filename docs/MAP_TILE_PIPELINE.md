# マップ素材パイプライン

## 素材の追加

スプライトシートと同名の設定ファイルを `assets-src/map-tiles/sheets/` に置きます。

```text
stairs.png
stairs.tileset.json
```

設定ファイルは `version`（`1`）、`id`、`label`、`tileSize`（`16` または `32`）、`margin`、`spacing`、`mapKinds`（`home` / `dungeon`）、`defaultLayer`、`defaultWalkable` を持ちます。画像は8-bit RGBAのPNGで、余白と間隔を除いた領域がタイルサイズの整数倍でなければなりません。

同じ `id` は一度しか登録できません。PNGだけ、またはJSONだけのペアはエラーになります。

## パレット

`assets-src/map-tiles/palettes.json` が正本です。ページは `id`、`label`、`mapKind`、`tileSize`、`width`、`height`、`cells` を持ちます。セルには `x`、`y`、`assetId`、`frame`、`layer`、`walkable` を保存します。空白セルは `cells` に含めません。

## 生成

```powershell
npm run assets
```

生成物は専用ディレクトリ `public/assets/map-tiles/generated/` と `src/game/mapAssetCatalog.generated.ts` に出力されます。生成ディレクトリ以外は掃除しません。`npm run dev`、`npm test`、`npm run build` は開始前に自動生成します。

開発サーバーでは `GET /__map-editor/palettes` で正本を読み取り、`PUT /__map-editor/palettes` に検証済みのパレットJSONを送ると、正本を一時ファイルから置換して再生成します。このAPIはVite開発サーバーにだけ登録され、本番ビルドには含まれません。旧クライアント向けに `GET/POST /__map-tiles/palettes.json` も利用できます。素材シートの追加・変更・削除は開発サーバーが監視し、成功時に全ページを再読込します。
