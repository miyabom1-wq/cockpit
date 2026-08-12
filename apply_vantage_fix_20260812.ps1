$ErrorActionPreference = 'Stop'
$Root = (Get-Location).Path
if (-not (Test-Path (Join-Path $Root '.git'))) { throw 'VANTAGE の Git リポジトリ直下で実行してください。' }
$Patch = Join-Path $PSScriptRoot 'vantage_theme_margin_fix_20260812.patch'
if (-not (Test-Path $Patch)) { throw "Patch not found: $Patch" }

$dirty = git status --porcelain
if ($dirty) { throw "未コミット変更があります。先に保存/コミットしてください。`n$dirty" }

git apply --check $Patch
git apply $Patch

Push-Location (Join-Path $Root 'worker')
try {
  node --check ..\public\theme-fixes-v72.js
  npm test
  npm run check
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'VANTAGE fix applied and tests completed.' -ForegroundColor Green
Write-Host 'Changed files:'
git status --short
