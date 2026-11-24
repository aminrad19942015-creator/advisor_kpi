$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

if (-not (Test-Path ".env.local") -or -not (Test-Path "package.json")) {
  throw "Run this script from the real Connector folder."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (Test-Path ".\run-operational.ps1") {
  Copy-Item ".\run-operational.ps1" ".\run-operational.before-final-$stamp.bak" -Force
}

$schedulePin = "a6fd2c2d34555d51f4840480128d83ed29dcddce"
$verifyPin = "94a6f0cfc692034781553c3b6a54fa4bbd24b94c"

$files = @(
  @{ Name = "run-operational.ps1"; Url = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$schedulePin/connector/run-operational.ps1" },
  @{ Name = "run-activity.cmd"; Url = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$schedulePin/connector/run-activity.cmd" },
  @{ Name = "install-schedule.ps1"; Url = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$schedulePin/connector/install-schedule.ps1" },
  @{ Name = "install-history-schedule.ps1"; Url = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$schedulePin/connector/install-history-schedule.ps1" },
  @{ Name = "verify-schedule.ps1"; Url = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$schedulePin/connector/verify-schedule.ps1" },
  @{ Name = "verify-production.ps1"; Url = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$verifyPin/connector/verify-production.ps1" }
)

foreach ($item in $files) {
  Write-Host ("Updating " + $item.Name + "...")
  Invoke-WebRequest -UseBasicParsing -Uri $item.Url -OutFile (Join-Path $connectorDir $item.Name)
}

Write-Host ""
Write-Host "Installing split Open Leads / Activity schedules..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\install-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Open Leads schedule installation failed." }
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\install-history-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Activity schedule installation failed." }

Write-Host ""
Write-Host "Running final production verification..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\verify-production.ps1"
if ($LASTEXITCODE -ne 0) {
  throw "Final production verification failed."
}

Write-Host ""
Write-Host "COMPANY_PC_FINALIZATION_OK"
