param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("Activity","Open")]
  [string]$Mode
)

$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

$runtimeDir = Join-Path $connectorDir "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$logFile = if ($Mode -eq "Activity") {
  Join-Path $runtimeDir "activity-sync.log"
} else {
  Join-Path $runtimeDir "scheduled-sync.log"
}

function Write-RunLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Invoke-ConnectorScript([string]$Name) {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $nodePath (Join-Path $connectorDir $Name) 2>&1 | ForEach-Object {
      [IO.File]::AppendAllText($logFile, ([string]$_ + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    }
    $nativeExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  return [int]$nativeExit
}

function Test-ComponentFreshToday([string]$FileName) {
  $file = Join-Path $runtimeDir $FileName
  if (-not (Test-Path $file)) { return $false }

  try {
    $state = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$state.status -ne "success") { return $false }
    if (-not $state.finishedAt) { return $false }

    $finished = [datetimeoffset]::Parse([string]$state.finishedAt).ToLocalTime()
    return $finished.Date -eq (Get-Date).Date
  }
  catch {
    return $false
  }
}

function Invoke-OpenLeads {
  Write-RunLog "Open Leads sync started."
  $code = Invoke-ConnectorScript 'sync.js'
  if ($code -ne 0) {
    throw "Open Leads sync failed with exit code $code."
  }
  Write-RunLog "Open Leads sync completed successfully."
}

function Invoke-ActivityRecovery {
  param([switch]$ForceAll)

  $componentFailures = @()
  $ranAny = $false

  $leadOppFresh = Test-ComponentFreshToday "last-lead-opp-sync.json"
  $callsFresh = Test-ComponentFreshToday "last-calls-sync.json"
  $ticketsFresh = Test-ComponentFreshToday "last-tickets-sync.json"

  if ($ForceAll -or -not $leadOppFresh) {
    $ranAny = $true
    Write-RunLog "Lead/Opportunity activity sync started."
    $code = Invoke-ConnectorScript 'lead-opportunity-sync.js'
    if ($code -ne 0) {
      $componentFailures += "Lead/Opportunity"
      Write-RunLog "Lead/Opportunity history FAILED with exit code $code. Continuing."
    } else {
      Write-RunLog "Lead/Opportunity history completed."
    }
  } else {
    Write-RunLog "Lead/Opportunity already fresh today; skipped."
  }

  if ($ForceAll -or -not $callsFresh) {
    $ranAny = $true
    Write-RunLog "Calls activity sync started."
    $code = Invoke-ConnectorScript 'calls-sync.js'
    if ($code -ne 0) {
      $componentFailures += "Calls"
      Write-RunLog "Calls history FAILED with exit code $code. Continuing."
    } else {
      Write-RunLog "Calls history completed."
    }
  } else {
    Write-RunLog "Calls already fresh today; skipped."
  }

  if ($ForceAll -or -not $ticketsFresh) {
    $ranAny = $true
    Write-RunLog "Tickets activity sync started."
    $code = Invoke-ConnectorScript 'tickets-sync.js'
    if ($code -ne 0) {
      $componentFailures += "Tickets"
      Write-RunLog "Tickets history FAILED with exit code $code."
    } else {
      Write-RunLog "Tickets history completed."
    }
  } else {
    Write-RunLog "Tickets already fresh today; skipped."
  }

  if (-not $ranAny) {
    Write-RunLog "All activity components are already fresh today."
  }

  if ($componentFailures.Count -gt 0) {
    throw ("Activity sync completed with failed components: " + ($componentFailures -join ", "))
  }
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
  if ($Mode -eq "Activity") {
    Write-RunLog "07:30 Activity sync started: Lead/Opportunity, Calls and Tickets."
    Invoke-ActivityRecovery -ForceAll
    Write-RunLog "Activity sync completed successfully."
    exit 0
  }

  Write-RunLog "Open Leads trigger started."
  Invoke-OpenLeads

  # 07:00 is reserved for Open Leads. Activity starts at 07:30.
  # If the 07:30 task was missed (PC off / mutex race), later Open Leads
  # triggers recover only stale activity components.
  $now = Get-Date
  $activityRecoveryStart = $now.Date.AddHours(7).AddMinutes(30)
  if ($now -ge $activityRecoveryStart) {
    Invoke-ActivityRecovery
  } else {
    Write-RunLog "Activity recovery window starts at 07:30; skipped for this Open Leads run."
  }

  Write-RunLog "Open Leads trigger completed successfully."
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
