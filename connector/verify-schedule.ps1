$ErrorActionPreference = "Stop"

$openName = "Advisor CRM Open Leads Sync"
$morningName = "Advisor CRM Morning Sync"
$legacyName = "Advisor CRM Historical Activity Sync"

$open = Get-ScheduledTask -TaskName $openName -ErrorAction Stop
$morning = Get-ScheduledTask -TaskName $morningName -ErrorAction Stop

if ($open.Triggers.Count -ne 3) {
  throw "$openName must have exactly 3 triggers (09:00, 12:00, 15:00); found $($open.Triggers.Count)."
}
if ($morning.Triggers.Count -ne 1) {
  throw "$morningName must have exactly 1 trigger (07:00); found $($morning.Triggers.Count)."
}
if (Get-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue) {
  throw "Legacy task still exists: $legacyName"
}

$expectedDays = @("Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday")
$expectedOpenTimes = @("09:00","12:00","15:00")
$actualOpenTimes = @($open.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString("HH:mm") } | Sort-Object)
$actualMorningTimes = @($morning.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString("HH:mm") } | Sort-Object)

if (($actualMorningTimes -join ",") -ne "07:00") {
  throw "$morningName must run at 07:00; found $($actualMorningTimes -join ', ')."
}
if (($actualOpenTimes -join ",") -ne (($expectedOpenTimes | Sort-Object) -join ",")) {
  throw "$openName times are incorrect; found $($actualOpenTimes -join ', ')."
}

foreach ($trigger in @($open.Triggers) + @($morning.Triggers)) {
  $daysText = [string]$trigger.DaysOfWeek
  foreach ($day in $expectedDays) {
    if ($daysText -notmatch $day) {
      throw "Schedule is missing $day in trigger $($trigger.StartBoundary)."
    }
  }
  if ($daysText -match "Friday") {
    throw "Friday must not be enabled in CRM schedules."
  }
}

if (-not $open.Settings.StartWhenAvailable -or -not $morning.Settings.StartWhenAvailable) {
  throw "StartWhenAvailable must be enabled for both CRM tasks."
}

Write-Host ""
Write-Host "=== SCHEDULE VERIFICATION ==="
Write-Host "$morningName"
$morning.Triggers | Select-Object StartBoundary,DaysOfWeek,Enabled | Format-Table -AutoSize
Write-Host "$openName"
$open.Triggers | Select-Object StartBoundary,DaysOfWeek,Enabled | Format-Table -AutoSize

$morningInfo = Get-ScheduledTaskInfo -TaskName $morningName
$openInfo = Get-ScheduledTaskInfo -TaskName $openName
Write-Host "Morning next run: $($morningInfo.NextRunTime)"
Write-Host "Open Leads next run: $($openInfo.NextRunTime)"
Write-Host "Policy: Saturday-Thursday only; 07:00 morning serial run + 09:00/12:00/15:00 Open Leads."
Write-Host "Global mutex prevents overlapping CRM browser sessions."
