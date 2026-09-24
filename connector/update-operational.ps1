$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

$base = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/main/connector"
$files = @(
  "sync.js",
  "config-client.js",
  "local-backup.js",
  "recovery-lib.js",
  "recover-local.js",
  "command-client.js",
  "lead-opportunity-sync.js",
  "calls-sync.js",
  "tickets-sync.js",
  "run.cmd",
  "run-history.cmd",
  "install-schedule.ps1",
  "install-history-schedule.ps1"
)

foreach ($file in $files) {
  Write-Host "Updating $file..."
  Invoke-WebRequest "$base/$file" -OutFile (Join-Path $connectorDir $file)
}

Write-Host ""
Write-Host "Installing Open Leads schedule..."
powershell -ExecutionPolicy Bypass -File (Join-Path $connectorDir "install-schedule.ps1")

Write-Host ""
Write-Host "Installing Historical Activity schedule..."
powershell -ExecutionPolicy Bypass -File (Join-Path $connectorDir "install-history-schedule.ps1")

Write-Host ""
Write-Host "Operational connector update completed."
Write-Host "Open Leads: 07:00, 09:00, 12:00, 15:00"
Write-Host "Historical activity: 07:00 only"
