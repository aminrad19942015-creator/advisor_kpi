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

$files = @(
  @{
    Name = "run-operational.ps1"
    Url  = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/1faaea3b87648f4c3cf846346d0a201968d1f320/connector/run-operational.ps1"
  },
  @{
    Name = "verify-schedule.ps1"
    Url  = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/9cb37bfd35757a8983208de07d8c3b39157cf371/connector/verify-schedule.ps1"
  },
  @{
    Name = "verify-production.ps1"
    Url  = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/94a6f0cfc692034781553c3b6a54fa4bbd24b94c/connector/verify-production.ps1"
  }
)

foreach ($item in $files) {
  Write-Host ("Updating " + $item.Name + "...")
  Invoke-WebRequest -UseBasicParsing -Uri $item.Url -OutFile (Join-Path $connectorDir $item.Name)
}

Write-Host ""
Write-Host "Running final production verification..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\verify-production.ps1"
if ($LASTEXITCODE -ne 0) {
  throw "Final production verification failed."
}

Write-Host ""
Write-Host "COMPANY_PC_FINALIZATION_OK"
