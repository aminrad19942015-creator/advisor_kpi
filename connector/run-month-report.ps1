$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

$runtimeDir = Join-Path $connectorDir "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$logFile = Join-Path $runtimeDir "month-report-sync.log"

function Write-RunLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\AdvisorKpiConnectorMutex", [ref]$createdNew)
$hasMutex = $createdNew

if (-not $hasMutex) {
  try {
    $hasMutex = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $hasMutex = $true
  }
}

if (-not $hasMutex) {
  Write-RunLog "Another Advisor KPI connector run is active. Month-report trigger skipped; the next daily trigger will retry if still due."
  $mutex.Dispose()
  exit 0
}

try {
  Write-RunLog "Previous Persian-month report check started."
  & node (Join-Path $connectorDir "report-month-sync.js") >> $logFile 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Previous-month report sync failed with exit code $LASTEXITCODE."
  }
  Write-RunLog "Previous Persian-month report check completed successfully."
  exit 0
}
catch {
  Write-RunLog ("FAILED: " + $_.Exception.Message)
  exit 1
}
finally {
  if ($hasMutex) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  $mutex.Dispose()
}
