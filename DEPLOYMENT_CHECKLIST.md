# VANTAGE v35 デプロイチェック表

## GitHub

- [ ] 旧 `cockpit` をZIP保存
- [ ] 旧リポジトリを `cockpit-legacy-20260716` へ変更
- [ ] 新しい空の `cockpit` を作成
- [ ] `.github`、`public`、`worker`、文書をアップロード
- [ ] `node_modules` がない
- [ ] `.wrangler` がない
- [ ] GitHub Pages SourceがGitHub Actions
- [ ] `Deploy VANTAGE Pages` が成功
- [ ] `Verify VANTAGE` が成功

## Cloudflare

- [ ] 既存Worker `cockpit-backend` を選択
- [ ] 新しいGitHub `cockpit` を接続
- [ ] Root directory = `worker`
- [ ] Build command = `npm run check && npm test`
- [ ] Deploy command = `npx wrangler deploy`
- [ ] COCKPIT_KVが既存KVを指す
- [ ] WRITE_TOKENを確認
- [ ] Cron `*/5 * * * *`
- [ ] Build成功

## 稼働確認

- [ ] `/api/health` がv35.0.0
- [ ] entrypointがsrc/index.js
- [ ] schemaがvantage-kv-v3
- [ ] 日本株Stage再計算成功
- [ ] 米国株Stage再計算成功
- [ ] ウォッチ価格表示
- [ ] ウォッチ再判定成功
- [ ] シグナル日米分離
- [ ] シグナル当日が結果待ち表示
- [ ] ランキング更新成功
- [ ] 探索候補表示
- [ ] KV Writesを翌日確認
