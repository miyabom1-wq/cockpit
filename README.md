# VANTAGE v35 完全差し替え版

日本株を主対象、米国株を海外リード確認として使うモメンタム投資判断支援アプリです。
自動売買ではなく、地合い・日足レジーム・相対強度・出来高・短期セットアップ・事後検証を整理します。

## 正本

- フロントエンド: `public/`
- Cloudflare Worker: `worker/src/index.js`
- Worker設定: `worker/wrangler.toml`
- 分析エンジン: `worker/src/engine/`
- ライブ分析とバックテストは同じ分析関数を使用

旧版にあった `src/worker.js`、複数世代の統合ファイル、`node_modules`、`.wrangler` は含みません。

## 主な設計

- `/api/health` で version / build / schema / engine を確認
- RSI14・ATR14はWilder RMA
- テクニカルOHLCは配当調整を混ぜず、必要な株式分割だけ正規化
- Stageは分割バッチの作業領域へ保存し、全バッチ完成後だけ公開
- 銘柄ごとに取引日・確定状態・OHLC整合性・snapshot IDを検証
- 無効データはA/B/Cへ入れずDへ退避
- シグナル結果は確定終値だけを使用
- バックテストの5日線割れは翌営業日始値で決済
- 同一日足内でトリガーとストップの順序が不明な取引は除外
- バックテスト完了後は5分Cronで不要なKV書き込みを行わない

## フォルダ

```text
VANTAGE_v35_RELEASE/
├─ public/                 GitHub Pagesへ配信
├─ worker/                 Cloudflare Worker
│  ├─ src/
│  ├─ test/
│  ├─ package.json
│  ├─ package-lock.json
│  └─ wrangler.toml
├─ .github/workflows/      Pages配信と自動検証
├─ SETUP.md                初回アップ手順
├─ USAGE_GUIDE.md          画面の使い方
└─ DEPLOYMENT_CHECKLIST.md 作業チェック表
```

## 検証

リリース作成時に以下を実行済みです。

```text
構文チェック
21件の自動テスト
Wrangler 4.111.0 dry-run
npm audit: 0 vulnerabilities
ランキング探索35銘柄の外部通信: 37回（50回未満）
```

詳しい導入は `SETUP.md` を参照してください。
