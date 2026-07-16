# VANTAGE v35 検証報告

## リリース識別

- App: `v35.0.0`
- Build: `20260716-full-replacement-release1`
- Worker entrypoint: `worker/src/index.js`
- KV schema: `vantage-kv-v3`
- Analysis engine: `engine-v35.0.0`
- Backtest: `registered-bt-v3-parity`

## 実施した検証

- Worker全29 JavaScriptファイルの構文検査
- フロントエンド内JavaScriptの構文検査
- Service Workerの構文検査
- Node標準テスト21件
- Cloudflare Wrangler 4.111.0によるdeploy dry-run
- npm依存関係の脆弱性監査
- 配布物の秘密情報・ローカル絶対パス・不要生成物の検査

## 結果

- 構文検査: 成功
- テスト: 21件中21件成功
- Wrangler dry-run: 成功
- Worker upload見積: 135.65 KiB、gzip 36.48 KiB
- npm audit: 既知の脆弱性0件
- `node_modules` / `.wrangler` / `.env`: 配布物に含まれない
- 秘密鍵、APIキー、アクセストークン: 配布物から未検出

## 重要なテスト対象

- ライブ分析とバックテストの共通エンジン整合
- Wilder RSI / ATR
- 配当調整値をテクニカルOHLCへ誤適用しないこと
- 株式分割の価格連続性補正
- 古い・未確定データがA/B/C候補へ入らないこと
- 全バッチ完成前にStageを公開しないこと
- シグナル当日に0.0%を記録しないこと
- 無効データで進行中シグナルを終了させないこと
- 旧シグナルデータの初回移行
- ランキング一括分析がベンチマークを共有し、模擬サブリクエスト37回に収まること
- バックテスト完了後の不要な常時再集計を抑止すること

## 本番反映後に必要な確認

ローカル検証とdry-runでは、実際のYahoo Finance応答、実Cloudflare KV、Cron、GitHub Pagesの配信までは再現できません。デプロイ後に以下を確認してください。

1. `/api/health` がリリース識別情報を返す
2. 日本株・米国株の手動再計算が完了する
3. Cron後にsnapshot日時が進む
4. ウォッチ価格と個別再判定が動く
5. シグナル検証が確定終値だけで進む
6. KV Writesが異常増加しない
