$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

if (-not (Test-Path ".env.local") -or -not (Test-Path "package.json")) {
  throw "Run this installer from the real advisor_kpi connector folder."
}

$pin = "15b1ba6aaac5eda86d8d8be3c1f981b18d9781d9"
$base = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$pin/connector"
$files = @(
  "persian-month.js",
  "test-persian-month.js",
  "report-month-sync.js",
  "run-month-report.ps1",
  "run-month-report.cmd",
  "install-month-report-schedule.ps1",
  "verify-month-report-schedule.ps1"
)

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
foreach ($name in $files) {
  $dest = Join-Path $connectorDir $name
  if (Test-Path $dest) {
    Copy-Item $dest ($dest + ".before-month-report-" + $stamp + ".bak") -Force
  }
  Write-Host ("Downloading " + $name + "...")
  Invoke-WebRequest -UseBasicParsing -Uri ($base + "/" + $name) -OutFile $dest
}

Write-Host ""
Write-Host "[1/3] Persian month boundary test..."
& node ".\test-persian-month.js"
if ($LASTEXITCODE -ne 0) { throw "Persian month range test failed." }

Write-Host ""
Write-Host "[2/3] Installing the independent monthly-report task..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\install-month-report-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Month-report task installation failed." }

Write-Host ""
Write-Host "[3/3] Verifying the independent monthly-report task..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\verify-month-report-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Month-report schedule verification failed." }

Write-Host ""
Write-Host "Existing Advisor CRM Morning/Open Leads tasks were not changed."
Write-Host "MONTH_REPORT_FEATURE_INSTALLED"
Write-Host ""
Write-Host "Running the month-report check once now..."
cmd.exe /d /c ".\run-month-report.cmd"
if ($LASTEXITCODE -ne 0) { throw "Initial month-report run failed." }

Write-Host ""
Write-Host "MONTH_REPORT_INITIAL_RUN_OK"
