# ドキュメント案内

## ゲーム設計・実装計画

- [GAMEPLAY_IMPLEMENTATION_PLAN.md](GAMEPLAY_IMPLEMENTATION_PLAN.md) — 町を廃止した自宅店舗⇄ダンジョンのゲームループ、護衛戦闘、遺体・戦利品、店舗運営、実装フェーズ、未決事項

## アセット制作

- [ASSET_SPEC.md](ASSET_SPEC.md) — ゲームへ組み込む画像の固定寸法、セル座標、フレーム順
- [ASSET_GENERATION.md](ASSET_GENERATION.md) — 生成AIへ渡す依頼文、モデル方針、受入チェック
- [ASSET_PIPELINE.md](ASSET_PIPELINE.md) — 現在の実装状況、原画からPNGへの変換、未統合項目

### 使い分け

- 外注・生成AIへ依頼する前: `ASSET_SPEC`と対象カテゴリの`ASSET_GENERATION`を渡す。
- 既存画像を差し替える時: `ASSET_PIPELINE`の差し替え手順に従う。
- 座標が食い違う時: `src/game/assetFrames.ts`と`src/game/assets.ts`を最優先する。

アセットの仕様変更では、文書だけでなくコード上のフレーム契約とテストも同じ変更に含めてください。
