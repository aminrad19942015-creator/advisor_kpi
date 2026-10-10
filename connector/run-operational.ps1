param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("Morning","Open")]
  [string]$Mode
)

$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

$runtimeDir = Join-Path $connectorDir "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$logFile = if ($Mode -eq "Morning") {
  Join-Path $runtimeDir "morning-sync.log"
} else {
  Join-Path $runtimeDir "scheduled-sync.log"
}

function Write-RunLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

if ((Get-Date).DayOfWeek -eq [DayOfWeek]::Friday) {
  Write-RunLog "Friday - sync skipped by safety guard."
  exit 0
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
  Write-RunLog "Another Advisor KPI connector run is already active. This trigger is skipped to prevent overlapping CRM sessions."
  $mutex.Dispose()
  exit 0
}

try {
  if ($Mode -eq "Open") {
    Write-RunLog "Open Leads sync started."
    & cmd.exe /d /c "npm run sync" >> $logFile 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Open Leads sync failed with exit code $LASTEXITCODE."
    }
    Write-RunLog "Open Leads sync completed successfully."
    exit 0
  }

  Write-RunLog "Morning sync started: Open Leads first, then historical activity."

  & cmd.exe /d /c "npm run sync" >> $logFile 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Morning Open Leads sync failed with exit code $LASTEXITCODE."
  }
  Write-RunLog "Morning Open Leads completed."

  $componentFailures = @()

  & node (Join-Path $connectorDir "lead-opportunity-sync.js") >> $logFile 2>&1
  if ($LASTEXITCODE -ne 0) {
    $componentFailures += "Lead/Opportunity"
    Write-RunLog "Lead/Opportunity history FAILED with exit code $LASTEXITCODE. Continuing with remaining components."
  } else {
    Write-RunLog "Lead/Opportunity history completed."
  }

  & node (Join-Path $connectorDir "calls-sync.js") >> $logFile 2>&1
  if ($LASTEXITCODE -ne 0) {
    $componentFailures += "Calls"
    Write-RunLog "Calls history FAILED with exit code $LASTEXITCODE. Continuing with remaining components."
  } else {
    Write-RunLog "Calls history completed."
  }

  & node (Join-Path $connectorDir "tickets-sync.js") >> $logFile 2>&1
  if ($LASTEXITCODE -ne 0) {
    $componentFailures += "Tickets"
    Write-RunLog "Tickets history FAILED with exit code $LASTEXITCODE."
  } else {
    Write-RunLog "Tickets history completed."
  }

  if ($componentFailures.Count -gt 0) {
    throw ("Morning sync completed with failed components: " + ($componentFailures -join ", "))
  }

  Write-RunLog "Morning sync completed successfully."
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
