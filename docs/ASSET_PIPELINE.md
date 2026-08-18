# アセット実装・変換パイプライン

更新日: 2026-08-18

## ディレクトリ

```text
assets-src/                 生成原画、参照画像、中間素材
public/assets/map-tiles/    home/dungeonの4つの地形素材
public/assets/actors/       方向別キャラクターシート
public/assets/ui/           UI素材
public/assets/objects/      アイテム、階段、宝箱、罠など
public/assets/preview/      必要なレビュー画像
```

ゲーム側の地形参照先は `src/game/mapTiles.ts`、実行時パスは `src/game/assets.ts` です。手動マップは保存済みのレイヤーとフレームをそのまま描画します。

## 4素材の差し替え

次の固定パスへ同じ寸法のPNGを置き換えます。

1. `public/assets/map-tiles/home-floor.png` — 16×16、床1枚
2. `public/assets/map-tiles/home-wall.png` — 64×64、手動選択する16フレーム
3. `public/assets/map-tiles/dungeon-floor.png` — 16×16、床1枚
4. `public/assets/map-tiles/dungeon-wall.png` — 64×64、手動選択する16フレーム

仮素材は `scripts/generate-map-tile-placeholders.cjs` で再生成できます。差し替え後は `npm test` と `npm run build` を実行してください。

## 保持素材

キャラクター、UI、アイテム、階段、宝箱、罠の素材と、それらの原画・変換処理は保持します。地形画像から当たり判定を推測せず、マップJSONの明示collisionを使います。
