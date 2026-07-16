# VANTAGE v35 完全差し替え手順

## 方針

今回は旧フォルダや旧GitHubリポジトリへ継ぎ足しません。
旧リポジトリを退避名へ変更し、新しい空の `cockpit` リポジトリへこの一式をアップします。
Cloudflareは既存の `cockpit-backend` と既存KVを使うため、登録銘柄・ウォッチ・保有・イベント・シグナル履歴を維持します。

ローカルのPowerShellやnpm操作は不要です。

---

## 1. ダウンロードと展開

1. `VANTAGE_v35_FULL_REPLACEMENT.zip` をダウンロード
2. Windowsの「すべて展開」で解凍
3. 展開後、直下に次があることを確認

```text
public
worker
.github
README.md
SETUP.md
USAGE_GUIDE.md
DEPLOYMENT_CHECKLIST.md
```

`node_modules` と `.wrangler` が無いことも確認します。

---

## 2. 旧GitHubリポジトリを退避

1. GitHubで現在の `cockpit` リポジトリを開く
2. `Code` → `Download ZIP` で念のため保存
3. `Settings` → `General`
4. Repository nameを `cockpit-legacy-20260716` に変更

削除ではなく名前変更なので、元コードを残したまま新規作成できます。

---

## 3. 新しいGitHubリポジトリを作る

1. GitHub右上の `+` → `New repository`
2. Repository name: `cockpit`
3. Publicを選択
4. README等の自動作成はすべてOFF
5. `Create repository`
6. 表示された画面の `uploading an existing file` を押す
7. 展開したフォルダの中身をすべてドラッグしてアップロード

アップするのは外側のフォルダそのものではなく、その中の次の項目です。

```text
.github
public
worker
.gitignore
README.md
SETUP.md
USAGE_GUIDE.md
DEPLOYMENT_CHECKLIST.md
RELEASE_NOTES.md
```

8. Commit messageへ `VANTAGE v35 full replacement` と入力
9. `Commit changes`

---

## 4. GitHub Pagesを有効化

1. 新しい `cockpit` リポジトリの `Settings`
2. 左側の `Pages`
3. Build and deploymentのSourceを `GitHub Actions` にする
4. `Actions` タブを開く
5. `Deploy VANTAGE Pages` が緑色になるまで待つ

公開URL:

```text
https://miyabom1-wq.github.io/cockpit/?v=35
```

この時点では画面だけ先に更新されます。Cloudflare Workerが旧版の間は、まだ本運用しません。

---

## 5. Cloudflare Workerを新GitHubへ接続

1. Cloudflare Dashboardを開く
2. `Workers & Pages`
3. `cockpit-backend`
4. `Settings`
5. `Builds`
6. 既存接続があればDisconnect
7. `Connect`
8. GitHubの新しい `cockpit` リポジトリを選択

Build設定:

```text
Production branch: main
Root directory: worker
Build command: npm run check && npm test
Deploy command: npx wrangler deploy
```

保存後にビルド履歴を確認します。自動で始まらない場合は、GitHubで `RELEASE_NOTES.md` を開き、末尾に空行を1つ追加してCommitしてください。GitHubへの新しいCommitがCloudflareのビルドを起動します。

重要:

```text
Cloudflare上のWorker名: cockpit-backend
worker/wrangler.tomlのname: cockpit-backend
```

この2つが一致している必要があります。

---

## 6. Cloudflareの設定確認

`cockpit-backend` → `Settings` で確認します。

### Bindings

```text
Variable name: COCKPIT_KV
Type: KV Namespace
```

既存のVANTAGE用KVへ接続されていることを確認します。

### Variables & Secrets

WRITE_TOKENを以前設定していた場合は残っているか確認します。
残っていなければ、同じ値をSecretとして再設定します。

```text
WRITE_TOKEN       任意。書き込み・個人データ読み取りの保護
VAPID_PRIVATE_KEY Push通知を使う場合のみ
VAPID_SUBJECT     Push通知を使う場合のみ
```

APIキーをソースやGitHubへ書かないでください。

### Cron Triggers

```text
*/5 * * * *
```

が1件あることを確認します。

---

## 7. バックエンドの成功確認

ブラウザで開きます。

```text
https://cockpit-backend.miyab.workers.dev/api/health
```

次を確認します。

```text
"version":"v35.0.0"
"entrypoint":"src/index.js"
"schema":"vantage-kv-v3"
"engine":"engine-v35.0.0"
"backtest":"registered-bt-v3-parity"
```

初回のhealthアクセス時に旧シグナルデータの移行も自動実行されます。

---

## 8. アプリ初回起動

1. `https://miyabom1-wq.github.io/cockpit/?v=35` を開く
2. 設定を開く
3. CloudflareにWRITE_TOKENを設定している場合、同じ文字列を「書き込みキー」へ保存
4. 日本株を選び `現在市場を再計算`
5. 米国株へ切り替え、同じく `現在市場を再計算`

再計算は日本8バッチ、米国2バッチです。
途中のバッチは公開Stageへ混ぜず、全バッチが完成した時だけ新しいsnapshotへ切り替わります。

---

## 9. データの扱い

既存KVを使うため、次は原則維持されます。

```text
登録銘柄
ウォッチ
保有状態
イベント
Push購読
旧シグナル履歴（v3→v5へ自動コピー）
```

バックテストは計算方式を変更したため、新しいversionキーでゼロから再計算します。
旧集計を新集計へ混ぜません。

---

## 10. 最終確認

```text
□ GitHub Pagesの画面が開く
□ /api/health がv35.0.0
□ Stageにsnapshot IDが表示される
□ 日本株と米国株が分離される
□ ウォッチ価格が表示される
□ ウォッチの「価格・判定を更新」が動く
□ シグナル当日は0.0%ではなく「翌営業日の終値待ち」
□ Cloudflare Cronが*/5
□ KV Writesが異常増加していない
```

---

## ロールバック

問題が出た場合:

1. Cloudflare `cockpit-backend` → `Deployments` / `Version History`
2. v35直前の正常なVersionへRollback
3. GitHubの新 `cockpit` を一時停止または名前変更
4. `cockpit-legacy-20260716` を `cockpit` へ戻す

KV自体は削除しません。
