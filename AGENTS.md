# Web版プロジェクトの作業境界

このディレクトリは Dungeon Curio Merchant の Web版専用プロジェクトです。実装対象は Phaser/Vite の TypeScript アプリケーションで、Unity版は別リポジトリ `C:\development\merchan-Unity` にあります。

## 変更範囲

- ゲーム実装: `src/`
- Web実行アセット: `public/assets/`
- Web用の原本・変換素材: `assets-src/`
- Web用変換スクリプト: `scripts/`
- Web設計資料: `docs/`

通常のWeb実装では、`C:\development\merchan-Unity`やUnityのC#コードを変更しない。Unityを対象にする依頼は、Unity側のリポジトリを作業ディレクトリとして明示的に扱う。

## 検証

```powershell
npm test
npm run build
```

本番公開物はルートで生成される`dist/`であり、Unityプロジェクトや`node_modules/`をWebの配信物へ含めない。
