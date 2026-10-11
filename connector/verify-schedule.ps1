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

$expectedOpenTimes = @("09:00","12:00","15:00")
$actualOpenTimes = @($open.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString("HH:mm") } | Sort-Object)
$actualMorningTimes = @($morning.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString("HH:mm") } | Sort-Object)

if (($actualMorningTimes -join ",") -ne "07:00") {
  throw "$morningName must run at 07:00; found $($actualMorningTimes -join ', ')."
}
if (($actualOpenTimes -join ",") -ne (($expectedOpenTimes | Sort-Object) -join ",")) {
  throw "$openName times are incorrect; found $($actualOpenTimes -join ', ')."
}

function Assert-TaskDays([string]$TaskName) {
  [xml]$xml = Export-ScheduledTask -TaskName $TaskName
  $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace("t", $xml.DocumentElement.NamespaceURI)

  $dayNodes = $xml.SelectNodes("//t:CalendarTrigger/t:ScheduleByWeek/t:DaysOfWeek/*", $ns)
  $days = @($dayNodes | ForEach-Object { $_.LocalName })

  $expected = @("Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday")
  foreach ($day in $expected) {
    if ($days -notcontains $day) {
      throw "$TaskName is missing $day. Actual days: $($days -join ', ')."
    }
  }
  if ($days -contains "Friday") {
    throw "$TaskName must not run on Friday."
  }
  if ($days.Count -ne 6) {
    throw "$TaskName must run on exactly 6 days. Actual days: $($days -join ', ')."
  }
}

Assert-TaskDays $openName
Assert-TaskDays $morningName

if (-not $open.Settings.StartWhenAvailable -or -not $morning.Settings.StartWhenAvailable) {
  throw "StartWhenAvailable must be enabled for both CRM tasks."
}

$openAction = $open.Actions | Select-Object -First 1
$morningAction = $morning.Actions | Select-Object -First 1

Write-Host ""
Write-Host "=== SCHEDULE VERIFICATION ==="
Write-Host "$morningName"
$morning.Triggers | Select-Object StartBoundary,Enabled | Format-Table -AutoSize
Write-Host "Action: $($morningAction.Execute) $($morningAction.Arguments)"
Write-Host "$openName"
$open.Triggers | Select-Object StartBoundary,Enabled | Format-Table -AutoSize
Write-Host "Action: $($openAction.Execute) $($openAction.Arguments)"

$morningInfo = Get-ScheduledTaskInfo -TaskName $morningName
$openInfo = Get-ScheduledTaskInfo -TaskName $openName
Write-Host "Morning next run: $($morningInfo.NextRunTime)"
Write-Host "Open Leads next run: $($openInfo.NextRunTime)"
Write-Host "Policy: Saturday-Thursday only; 07:00 morning serial run + 09:00/12:00/15:00 Open Leads."
Write-Host "Global mutex prevents overlapping CRM browser sessions."
Write-Host ""
Write-Host "SCHEDULE_VERIFICATION_OK"
