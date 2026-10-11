$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

$envFile = Join-Path $connectorDir ".env.local"
$packageFile = Join-Path $connectorDir "package.json"

if (-not (Test-Path $envFile) -or -not (Test-Path $packageFile)) {
  throw "This script must be run from the real Connector folder. Required files not found: .env.local and/or package.json. Current folder: $connectorDir"
}

$base = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/gas-dashboard-v1/connector"
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
  "show-token-hash.ps1"
)

foreach ($file in $files) {
  Write-Host "Updating $file..."
  Invoke-WebRequest "$base/$file" -OutFile (Join-Path $connectorDir $file)
}

Write-Host ""
Write-Host "Installing 07:00 Morning schedule..."
powershell -ExecutionPolicy Bypass -File (Join-Path $connectorDir "install-history-schedule.ps1")

Write-Host ""
Write-Host "Installing intraday Open Leads schedule..."
powershell -ExecutionPolicy Bypass -File (Join-Path $connectorDir "install-schedule.ps1")

Write-Host ""
Write-Host "Verifying schedules..."
powershell -ExecutionPolicy Bypass -File (Join-Path $connectorDir "verify-schedule.ps1")

Write-Host ""
Write-Host "Operational connector update completed."
Write-Host "Days: Saturday-Thursday (Friday disabled)"
Write-Host "07:00: Open Leads, then historical activity serially"
Write-Host "09:00, 12:00, 15:00: Open Leads"
Write-Host "Overlap protection: enabled by a global Windows mutex"
Write-Host "Missed-run recovery: enabled (StartWhenAvailable)"
