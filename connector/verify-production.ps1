$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

Write-Host "=== ADVISOR KPI PRODUCTION VERIFICATION ==="
Write-Host ""

if (-not (Test-Path ".env.local")) { throw ".env.local not found in Connector folder." }
if (-not (Test-Path "package.json")) { throw "package.json not found in Connector folder." }

Write-Host "[1/3] Supabase Connector endpoints..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\verify-supabase-endpoints.ps1"
if ($LASTEXITCODE -ne 0) { throw "Supabase endpoint verification failed." }

Write-Host ""
Write-Host "[2/3] Windows schedules..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ".\verify-schedule.ps1"
if ($LASTEXITCODE -ne 0) { throw "Schedule verification failed." }

Write-Host ""
Write-Host "[3/3] Recent local sync state..."
$files = @(
  "runtime\last-sync.json",
  "runtime\last-lead-opp-sync.json",
  "runtime\last-calls-sync.json",
  "runtime\last-tickets-sync.json"
)
foreach ($file in $files) {
  if (Test-Path $file) {
    $json = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host ("OK  " + $file + " -> " + [string]$json.status + " @ " + [string]$json.finishedAt)
  } else {
    Write-Host ("WARN " + $file + " not found.")
  }
}

Write-Host ""
Write-Host "PRODUCTION_VERIFICATION_OK"
