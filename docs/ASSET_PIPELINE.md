# アセット実装・変換パイプライン

更新日: 2026-09-06

現在の原本、アニメーション、通行判定と移行仕様は [統一ピクセルアート](UNIFIED_PIXEL_ART.md) を参照。

## ディレクトリ

```text
assets-src/                 生成原画、参照画像、中間素材
public/assets/map-tiles/    生成済みタイルと互換用の4地形素材
public/assets/actors/       方向別キャラクターシート
public/assets/ui/           UI素材
public/assets/objects/      アイテム、階段、宝箱、罠など
docs/art-*-preview.png      配置・アニメーションのレビュー画像
```

ゲーム側の地形参照先は `src/game/mapTiles.ts`、実行時パスは `src/game/assets.ts` です。手動マップは保存済みのレイヤーとフレームをそのまま描画します。

## 4素材の差し替え

次の固定パスへ同じ寸法のPNGを置き換えます。

1. `public/assets/map-tiles/home-floor.png` — 16×16、床1枚
2. `public/assets/map-tiles/home-wall.png` — 64×64、手動選択する16フレーム
3. `public/assets/map-tiles/dungeon-floor.png` — 16×16、床1枚
4. `public/assets/map-tiles/dungeon-wall.png` — 64×64、手動選択する16フレーム

互換用の4素材も `npm run assets:art` で統一原本から再生成します。旧仮素材の生成スクリプトは削除済みです。差し替え後は `npm test` と `npm run build` を実行してください。

## 保持素材

家の独立家具と使用中のUIを保持し、キャラクター・街・迷宮・アイテムの旧原本と実行画像を統一素材に置き換えました。地形画像から当たり判定を推測せず、マップJSONの明示collisionを使います。
