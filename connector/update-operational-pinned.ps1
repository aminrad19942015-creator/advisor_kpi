$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

$envFile = Join-Path $connectorDir ".env.local"
$packageFile = Join-Path $connectorDir "package.json"

if (-not (Test-Path $envFile) -or -not (Test-Path $packageFile)) {
  throw "Run this script from the real Connector folder. Missing .env.local and/or package.json. Current folder: $connectorDir"
}

$releaseRef = "29ff139797dc38f44eaf7a2c51933fce92e9c268"
$base = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$releaseRef/connector"

$files = @(
  "sync.js",
  "dashboard-http.js",
  "config-client.js",
  "local-backup.js",
  "recovery-lib.js",
  "recover-local.js",
  "command-client.js",
  "lead-opportunity-sync.js",
  "calls-sync.js",
  "tickets-sync.js",
  "run-operational.ps1",
  "run.cmd",
  "run-morning.cmd",
  "install-schedule.ps1",
  "install-history-schedule.ps1",
  "verify-schedule.ps1",
  "cutover-supabase.ps1",
  "verify-supabase-endpoints.ps1",
  "preflight-supabase-auth.ps1",
  "show-token-hash.ps1"
)

Write-Host "Installing Connector release: $releaseRef"
Write-Host ""

foreach ($file in $files) {
  $target = Join-Path $connectorDir $file
  $url = "$base/$file"
  Write-Host "Downloading $file..."
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $target
}

Write-Host ""
Write-Host "Installing 07:00 Morning schedule..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $connectorDir "install-history-schedule.ps1")
if ($LASTEXITCODE -ne 0) { throw "Morning schedule installation failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "Installing intraday Open Leads schedule..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $connectorDir "install-schedule.ps1")
if ($LASTEXITCODE -ne 0) { throw "Open Leads schedule installation failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "Verifying schedules..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $connectorDir "verify-schedule.ps1")
if ($LASTEXITCODE -ne 0) { throw "Schedule verification failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "PINNED_CONNECTOR_UPDATE_OK"
Write-Host "Release: $releaseRef"
