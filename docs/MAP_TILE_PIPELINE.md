# マップ素材パイプライン

## 素材の追加

スプライトシートと同名の設定ファイルを `assets-src/map-tiles/sheets/` に置きます。

```text
stairs.png
stairs.tileset.json
```

設定ファイルは `version`（`1`）、`id`、`label`、`tileSize`（`16` または `32`）、`margin`、`spacing`、`mapKinds`（`home` / `dungeon`）、`defaultLayer`、`defaultWalkable` を持ちます。画像は8-bit RGBAのPNGで、余白と間隔を除いた領域がタイルサイズの整数倍でなければなりません。

同じ `id` は一度しか登録できません。PNGだけ、またはJSONだけのペアはエラーになります。

## ZIP／TMX／PNGの取込

`/review.html` の「素材取込」からZIP、TMX/TSX一式、またはPNGを解析できます。複数ファイルを選択した場合はブラウザー側で一時ZIPにまとめます。CLIでは次の診断コマンドも使えます。

```powershell
npm run assets:inspect -- C:\path\to\pack.zip
```

TMXはtilesetの画像・グリッド情報を読み取り、アニメーション定義とアクション名が揃うものはキャラクター候補へ分類します。完成済みTMXマップのセル配置は今回のマップJSONへ自動変換しません。参照画像不足、寸法不一致、曖昧な分類は警告としてレビュー画面に残します。

PNG単体は16/32px候補と境界周期から初期値を推定しますが、レイヤー、通行可否、margin/spacingは承認前に変更できます。減色PNGは正規化されたRGBAコピーを生成します。

WOLF RPG Editorの`.tile`は自動接続規則を持つ独自形式として検出します。`base.png`や`world.png`などの静的シートは取り込めますが、自動接続そのものは再現せず、個別画像を通常グリッドとして使う場合は警告を表示します。

解析結果は30分間だけ開発サーバーの一時領域に保持され、「承認して登録」を押した候補だけが`assets-src/map-tiles/sheets/imported/`または`assets-src/actors/imported/`へ保存されます。原本のSHA-256、参照パス、README/ライセンスの有無は`imports.json`へ記録します。

## パレット

`assets-src/map-tiles/palettes.json` が正本です。ページは `id`、`label`、`mapKind`、`tileSize`、`width`、`height`、`cells` を持ちます。セルには `x`、`y`、`assetId`、`frame`、`layer`、`walkable` を保存します。空白セルは `cells` に含めません。

## 生成

```powershell
npm run assets
```

生成物は専用ディレクトリ `public/assets/map-tiles/generated/` と `src/game/mapAssetCatalog.generated.ts` に出力されます。生成ディレクトリ以外は掃除しません。`npm run dev`、`npm test`、`npm run build` は開始前に自動生成します。

開発サーバーでは `GET /__map-editor/palettes` で正本を読み取り、`PUT /__map-editor/palettes` に検証済みのパレットJSONを送ると、正本を一時ファイルから置換して再生成します。このAPIはVite開発サーバーにだけ登録され、本番ビルドには含まれません。旧クライアント向けに `GET/POST /__map-tiles/palettes.json` も利用できます。素材シートの追加・変更・削除は開発サーバーが監視し、成功時に全ページを再読込します。
