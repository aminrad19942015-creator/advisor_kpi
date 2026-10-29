$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

if (-not (Test-Path ".env.local") -or -not (Test-Path "package.json")) {
  throw "Run this installer from the real advisor_kpi connector folder."
}

$pin = "a6fd2c2d34555d51f4840480128d83ed29dcddce"
$base = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$pin/connector"
$files = @(
  "run-operational.ps1",
  "run-activity.cmd",
  "install-schedule.ps1",
  "install-history-schedule.ps1",
  "verify-schedule.ps1"
)

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
foreach ($name in $files) {
  $dest = Join-Path $connectorDir $name
  if (Test-Path $dest) {
    Copy-Item $dest ($dest + ".before-0730-split-" + $stamp + ".bak") -Force
  }
  Write-Host ("Downloading " + $name + "...")
  Invoke-WebRequest -UseBasicParsing -Uri ($base + "/" + $name) -OutFile $dest
}

Write-Host ""
Write-Host "[1/3] Installing Open Leads schedule..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\install-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Open Leads schedule installation failed." }

Write-Host ""
Write-Host "[2/3] Installing Activity schedule..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\install-history-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Activity schedule installation failed." }

Write-Host ""
Write-Host "[3/3] Verifying split schedules..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\verify-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Schedule verification failed." }

Write-Host ""
Write-Host "SCHEDULE_0730_SPLIT_OK"
Write-Host "Open Leads: 07:00 / 09:00 / 12:00 / 15:00"
Write-Host "Activity: 07:30"
Write-Host "Friday: disabled"
