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
