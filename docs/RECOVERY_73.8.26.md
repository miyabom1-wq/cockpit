# VANTAGE 73.8.26 recovery — validation in progress

Observed 2026-10-06 17:20 JST on production:
- HTTP health: v73.8.25, engine-v53-momentum, archive-d7cadf5def7e54ff.
- Published JP 104 / US 40 rows: engine-v52-null-safe, producer commit 8e1fbce09b68437006a5bd2be9cca994e067544d. No momentum fields on any row. GitHub main at that commit was v73.8.23. The active Cloudflare Cron deployment/routing still needs authenticated inspection.
- Credit: 2026-10-01 stale. Actions run 37339943670 failed with `anchor failed: 1301.T`. PDF unit-column x-coordinate changed from 228.71 to 227.75. Narrow coordinate tolerance now handles both; all code, ISIN, arithmetic and date checks remain.
- Backtest: 15/144 running, no recorded errors. Original scheduled cooldown was one hour per symbol and stage work could preempt it. Independent bounded Cron now attempts one symbol every five minutes subject to existing daily write budget. Benchmark failures retain hourly cooldown. Progress exposes last attempt/success/error and STOPPED after 30 minutes without progress.

Changes:
- Reconcile 73.8.24/25 momentum code and UI into current GitHub source, retaining current public earnings datasets.
- Report producer engine/build mismatch independently of price freshness.
- Mark stale per-symbol watch data, including symbols missing from current stage. Disable entry/holding assessments when data is stale or schema mismatched.
- Health components report market, momentum, credit, backtest and storage-read state. No green overall health when required data is missing.
- Persist PDF diagnostics before parser execution, including failed parses.
- Installer deploys only a clean Git checkout and verifies production source commit; no deploy-first/skip-GitHub behavior.

Validated locally:
- Existing suite: 240/240 tests passed.
- Two additional production-symptom regression tests passed.
- Python daily parser tests: 5/5 passed.
- Source syntax and esbuild bundle passed.
- Actual JPX PDFs for 2026-10-02 and 2026-10-05: 4,243 records, strict arithmetic checks passed.
- Latest generated credit file: as_of 2026-10-05, published 2026-10-06.

Still required before calling this complete:
- Confirm Cloudflare production and scheduled handler run this exact Git commit, bindings and independent Cron.
- Observe all requested JP/US rows with new fields and market data dates in production.
- Verify watch/holdings via authenticated session, including MSTR; refresh missing symbols through the registered-analysis path.
- Observe backtest complete or demonstrate persistent resume across actual Cron invocations and daily storage budget reset.
- Verify PWA upgrade and monitor API in actual browser, investigate historical 503 runtime logs.
- Add persistent per-source ingestion status and fully distinguish failed source retrieval from publication delay.

No claim of complete production recovery is made by this patch or by local tests.
