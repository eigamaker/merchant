# Dungeon Curio Merchant — Web edition

Web版専用のPhaser/Viteゲームです。主人公の通常ロケーションは自宅兼店舗（home）とダンジョン（dungeon）です。

## 起動

```powershell
npm install
npm run dev
```

## 操作

- 矢印キー / WASD: 移動
- Enter / Space: 会話・拾得・階段などの操作
- Esc: メニューを閉じる
- R: 帰還石で家へ帰還
- Z: 煙玉
- I / L / Q: 持ち物・記録・依頼
- H: 操作一覧

## マップと素材

家とダンジョンは `src/game/mapTiles.ts` のタイル登録と、reviewエディターで保存した手動レイヤーから描画します。床は16×16pxの単一画像、壁は16×16pxセルを4×4に並べたシートです。壁のフレームは隣接セルで変形せず、配置時の選択を保持します。通行可否はマップのcollisionレイヤーで編集します。

マップ編集画面は開発サーバーの [`/review.html`](review.html) です。`home` は1枚、`dungeon` は階層ごとに新規・複製して管理します。

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
