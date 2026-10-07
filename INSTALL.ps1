$ErrorActionPreference = 'Stop'
# Deploy only a clean Git checkout, so production always names an exact commit.
Set-Location $PSScriptRoot
$root = & git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { throw 'Use a fresh git clone of https://github.com/miyabom1-wq/cockpit.git, then run INSTALL.ps1.' }
$dirty = & git status --porcelain --untracked-files=normal
if ($dirty) { throw 'Working tree has local changes. Preserve them and use a fresh clone for deployment.' }
& git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'GitHub sync failed. Deployment stopped.' }
$commit = (& git rev-parse HEAD).Trim()
Push-Location worker
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
    & npm.cmd run check
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    & npm.cmd run deploy
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare deployment failed' }
} finally { Pop-Location }
$health = $null
for ($attempt=1; $attempt -le 12; $attempt++) {
    try {
        $nonce = [Guid]::NewGuid().ToString('N')
        $health = Invoke-RestMethod ("https://vantage-radar.miyab.workers.dev/api/health?verify=" + $nonce) -TimeoutSec 15 -Headers @{ 'Cache-Control'='no-cache' }
        if ($health.source_commit -eq $commit) { break }
        Write-Host "Waiting for deployment propagation ($attempt/12)"
    } catch { Write-Host "Health check retry ($attempt/12): $($_.Exception.Message)" }
    if ($attempt -lt 12) { Start-Sleep -Seconds 5 }
}
if (!$health -or $health.source_commit -ne $commit) {
    throw "Worker was uploaded, but version verification did not finish. Expected $commit. Do not redeploy blindly; inspect /api/health."
}
Write-Host "Deployment verified: $commit"
Write-Host 'Data pipelines must also recover. Inspect /api/health components; code deployment alone is not completion.'
$health.components | Format-List
