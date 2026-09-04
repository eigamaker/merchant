# ドキュメント案内

## Web版ゲーム設計・実装計画

- [GAMEPLAY_IMPLEMENTATION_PLAN.md](GAMEPLAY_IMPLEMENTATION_PLAN.md) — Web版の自宅店舗⇄ダンジョンのゲームループ、直接操作、インベントリ、店舗運営、実装順序
- [HOME_DUNGEON_AUTOTILE_PLAN.md](HOME_DUNGEON_AUTOTILE_PLAN.md) — 旧街一枚絵を廃止し、家／複数階層ダンジョンと手動配置レイヤーへ移行する実装仕様
- [DUNGEON_THEMES.md](DUNGEON_THEMES.md) — 手続き生成ダンジョン、テーマ契約、壁マスク順、アセット差し替え・検証手順
- [MERCHANT_LOOP.md](MERCHANT_LOOP.md) — 商人ゲームループの仕様。道具袋、護衛、露店、値付け、名簿、銘、遺体
- [DESIGN_BACKLOG.md](DESIGN_BACKLOG.md) — 設計提案と判断の台帳。採用・見送り・保留の理由を残し、全体レビューの起点にする
- [ECONOMY_BALANCE.md](ECONOMY_BALANCE.md) — 深度ごとのアイテム価格、護衛料、食料、一品物の価格帯と買い手。実測値と提案する梯子

## アセット制作

- [ASSET_SPEC.md](ASSET_SPEC.md) — home/dungeonの4マップ素材と保持素材の固定寸法、フレーム順
- [ASSET_GENERATION.md](ASSET_GENERATION.md) — 4マップ素材の生成指示と受入チェック
- [ASSET_PIPELINE.md](ASSET_PIPELINE.md) — home/dungeon素材の差し替え手順と保持素材

### 使い分け

- 外注・生成AIへ依頼する前: `ASSET_SPEC`と対象カテゴリの`ASSET_GENERATION`を渡す。
- 既存画像を差し替える時: `ASSET_PIPELINE`の差し替え手順に従う。
- タイルや座標が食い違う時: `src/game/mapTiles.ts`と`src/game/assets.ts`を最優先する。

アセットの仕様変更では、文書だけでなくコード上のフレーム契約とテストも同じ変更に含めてください。
