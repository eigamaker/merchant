# Craftpix ダンジョン統合

## 現在の構成

- 原典: `assets-src/vendor/craftpix-dungeon/Tiled_files/Dungeon1.tmx`
- 描画用レイヤー: `public/assets/dungeons/craftpix-showcase-base.png` と `craftpix-showcase-foreground.png`
- 衝突マニフェスト: `public/assets/dungeons/craftpix-showcase.json`
- ゲーム用レイアウト: `src/game/craftpixDungeonLayout.json`
- 入口: `(14, 24)`、階段: `(20, 4)`、タイルサイズ: `16px`

## 歩行判定

画像の透明部分をそのまま歩行判定には使わない。Tiled の床レイヤーから歩行候補を作り、`Walls` レイヤーを引き、ドアだけを通行可能として加える。最後に入口から幅優先探索を行い、入口から到達できない候補を自動的に壁へ戻す。

`collision` の `.` が歩行可能、`#` が進入不可である。これにより、装飾・水面・屋根の描画と衝突判定を分離できる。

## 再生成

```powershell
python scripts/build_craftpix_dungeon.py
npm test
npm run build
```

将来ランダム生成へ移行する場合は、まずこの固定マップを「部屋・通路・入口・階段」のテンプレートとして扱い、テンプレートを回転・反転・接続した後に同じ到達性検査を実行する。描画レイヤーはそのまま再利用し、衝突マスクだけを生成結果に合わせて差し替える。
