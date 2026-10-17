$ErrorActionPreference = "Stop"

$openName = "Advisor CRM Open Leads Sync"
$activityName = "Advisor CRM Activity Sync"
$legacyNames = @(
  "Advisor CRM Morning Sync",
  "Advisor CRM Historical Activity Sync"
)

$open = Get-ScheduledTask -TaskName $openName -ErrorAction Stop
$activity = Get-ScheduledTask -TaskName $activityName -ErrorAction Stop

if ($open.Triggers.Count -ne 4) {
  throw "$openName must have exactly 4 triggers (07:00, 09:00, 12:00, 15:00); found $($open.Triggers.Count)."
}
if ($activity.Triggers.Count -ne 1) {
  throw "$activityName must have exactly 1 trigger (07:30); found $($activity.Triggers.Count)."
}
foreach ($legacy in $legacyNames) {
  if (Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue) {
    throw "Legacy task still exists: $legacy"
  }
}

$expectedOpenTimes = @("07:00","09:00","12:00","15:00")
$actualOpenTimes = @($open.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString("HH:mm") } | Sort-Object)
$actualActivityTimes = @($activity.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString("HH:mm") } | Sort-Object)

if (($actualActivityTimes -join ",") -ne "07:30") {
  throw "$activityName must run at 07:30; found $($actualActivityTimes -join ', ')."
}
if (($actualOpenTimes -join ",") -ne (($expectedOpenTimes | Sort-Object) -join ",")) {
  throw "$openName times are incorrect; found $($actualOpenTimes -join ', ')."
}

function Assert-TriggerDays([string]$TaskName) {
  [xml]$xml = Export-ScheduledTask -TaskName $TaskName
  $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace("t", $xml.DocumentElement.NamespaceURI)

  $triggers = @($xml.SelectNodes("//t:CalendarTrigger", $ns))
  $expected = @("Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday")

  if ($triggers.Count -eq 0) {
    throw "$TaskName has no CalendarTrigger nodes."
  }

  for ($i = 0; $i -lt $triggers.Count; $i++) {
    $trigger = $triggers[$i]
    $dayNodes = @($trigger.SelectNodes("./t:ScheduleByWeek/t:DaysOfWeek/*", $ns))
    $days = @($dayNodes | ForEach-Object { $_.LocalName } | Sort-Object -Unique)

    foreach ($day in $expected) {
      if ($days -notcontains $day) {
        throw "$TaskName trigger #$($i + 1) is missing $day. Actual days: $($days -join ', ')."
      }
    }

    if ($days -contains "Friday") {
      throw "$TaskName trigger #$($i + 1) must not run on Friday."
    }

    if ($days.Count -ne 6) {
      throw "$TaskName trigger #$($i + 1) must run on exactly 6 unique days. Actual days: $($days -join ', ')."
    }
  }
}

Assert-TriggerDays $openName
Assert-TriggerDays $activityName

if (-not $open.Settings.StartWhenAvailable -or -not $activity.Settings.StartWhenAvailable) {
  throw "StartWhenAvailable must be enabled for both CRM tasks."
}

$openAction = $open.Actions | Select-Object -First 1
$activityAction = $activity.Actions | Select-Object -First 1

$expectedOpenCmd = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run.cmd"
$expectedActivityCmd = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run-activity.cmd"

function Assert-ActionPath([string]$TaskName,$Action,[string]$ExpectedCmd) {
  if ([string]$Action.Execute -ne "cmd.exe") {
    throw "$TaskName must execute cmd.exe; found $($Action.Execute)."
  }
  $args = [string]$Action.Arguments
  if ($args -notlike "*$ExpectedCmd*") {
    throw "$TaskName action points to the wrong Connector path. Expected: $ExpectedCmd. Actual: $args"
  }
}

Assert-ActionPath $openName $openAction $expectedOpenCmd
Assert-ActionPath $activityName $activityAction $expectedActivityCmd

foreach ($trigger in @($open.Triggers) + @($activity.Triggers)) {
  $dt = [datetime]$trigger.StartBoundary
  if ($dt.Second -ne 0) {
    throw "Trigger seconds must be 00; found $($dt.ToString('HH:mm:ss')) in $($trigger.StartBoundary)."
  }
}

if ($open.State -eq 'Disabled' -or $activity.State -eq 'Disabled') {
  throw "Both CRM scheduled tasks must be enabled."
}

Write-Host ""
Write-Host "=== SCHEDULE VERIFICATION ==="
Write-Host "$openName"
$open.Triggers | Select-Object StartBoundary,Enabled | Format-Table -AutoSize
Write-Host "Action: $($openAction.Execute) $($openAction.Arguments)"
Write-Host "$activityName"
$activity.Triggers | Select-Object StartBoundary,Enabled | Format-Table -AutoSize
Write-Host "Action: $($activityAction.Execute) $($activityAction.Arguments)"

$openInfo = Get-ScheduledTaskInfo -TaskName $openName
$activityInfo = Get-ScheduledTaskInfo -TaskName $activityName
Write-Host "Open Leads next run: $($openInfo.NextRunTime)"
Write-Host "Activity next run: $($activityInfo.NextRunTime)"
Write-Host "Policy: Saturday-Thursday; Open Leads at 07:00/09:00/12:00/15:00; Activity at 07:30."
Write-Host "09:00+ Open Leads runs recover stale Activity if the 07:30 run was missed."
Write-Host "Global mutex prevents overlapping CRM browser sessions."
Write-Host ""
Write-Host "SCHEDULE_VERIFICATION_OK"
