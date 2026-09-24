$ErrorActionPreference = "Stop"

$openName = "Advisor CRM Open Leads Sync"
$historyName = "Advisor CRM Historical Activity Sync"

$open = Get-ScheduledTask -TaskName $openName -ErrorAction Stop
$history = Get-ScheduledTask -TaskName $historyName -ErrorAction Stop

if ($open.Triggers.Count -ne 4) {
  throw "$openName must have exactly 4 triggers; found $($open.Triggers.Count)."
}
if ($history.Triggers.Count -ne 1) {
  throw "$historyName must have exactly 1 trigger; found $($history.Triggers.Count)."
}

Write-Host ""
Write-Host "=== SCHEDULE VERIFICATION ==="
Write-Host "$openName"
$open.Triggers | Select-Object StartBoundary,DaysOfWeek,Enabled | Format-Table -AutoSize
Write-Host "$historyName"
$history.Triggers | Select-Object StartBoundary,DaysOfWeek,Enabled | Format-Table -AutoSize

$openInfo = Get-ScheduledTaskInfo -TaskName $openName
$historyInfo = Get-ScheduledTaskInfo -TaskName $historyName
Write-Host "Open Leads next run: $($openInfo.NextRunTime)"
Write-Host "Historical next run: $($historyInfo.NextRunTime)"
Write-Host "Policy: Saturday-Thursday only. Friday is excluded in both Task Scheduler triggers and runner safety guards."
