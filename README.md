# Dungeon Curio Merchant — Web edition

Web版専用のPhaser/Viteゲームです。主人公の通常ロケーションは自宅兼店舗（home）とダンジョン（dungeon）です。

## 起動

```powershell
npm install
npm run dev
```

## 操作

移動キーの周りに操作をまとめています。

| キー | 動作 |
| --- | --- |
| 矢印キー / `WASD` | 移動・向き変更 |
| `E` | 調べる（拾う・宝箱・遺体・階段・冒険者との取引） |
| `R` | インベントリ／在庫管理 |
| `Q` | 正面の敵を押し返す |
| `Space` | 正面の敵を攻撃 |
| `T` | 話す（自宅） |
| `F` | 開店・閉店（自宅） |
| `Tab` / `Esc` | メニュー |

煙玉・帰還石・待機・護衛状態は、右のアクション一覧かメニューから選びます。

## マップと素材

家とダンジョンは `src/game/mapTiles.ts` のタイル登録と、reviewエディターで保存した手動レイヤーから描画します。床は16×16pxの単一画像、壁は16×16pxセルを4×4に並べたシートです。壁のフレームは隣接セルで変形せず、配置時の選択を保持します。通行可否はマップのcollisionレイヤーで編集します。

マップ編集画面は `npm run edit` で開きます（開発サーバー専用。素材の取り込みとパレット保存が dev サーバーのエンドポイントに依存するため、本番ビルドには含めません）。`home` は1枚、`dungeon` は階層ごとに新規・複製して管理します。

- `public/assets/map-tiles/home-floor.png`
- `public/assets/map-tiles/home-wall.png`
- `public/assets/map-tiles/dungeon-floor.png`
- `public/assets/map-tiles/dungeon-wall.png`

キャラクター、UI、アイテム、階段・宝箱・罠の素材は `public/assets/actors/`、`public/assets/ui/`、`public/assets/objects/` に保持します。詳細は [`docs/README.md`](docs/README.md) を参照してください。

## 検証

```powershell
npm test
npm run build
```
