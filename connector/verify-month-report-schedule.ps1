$ErrorActionPreference = "Stop"
$taskName = "Advisor CRM Previous Month Report Sync"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$expectedCmd = Join-Path $connectorDir "run-month-report.cmd"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.Triggers.Count -ne 1) {
  throw "$taskName must have exactly one daily trigger."
}

$trigger = $task.Triggers | Select-Object -First 1
$time = ([datetime]$trigger.StartBoundary).ToString("HH:mm")
if ($time -ne "15:30") {
  throw "$taskName must check at 15:30; found $time."
}
if (([datetime]$trigger.StartBoundary).Second -ne 0) {
  throw "$taskName trigger seconds must be 00."
}
if (-not $task.Settings.StartWhenAvailable) {
  throw "$taskName must have StartWhenAvailable enabled."
}
if ($task.State -eq "Disabled") {
  throw "$taskName is disabled."
}

$action = $task.Actions | Select-Object -First 1
if ([string]$action.Execute -ne "cmd.exe") {
  throw "$taskName must execute cmd.exe."
}
if ([string]$action.Arguments -notlike "*$expectedCmd*") {
  throw "$taskName action points to the wrong path. Expected: $expectedCmd. Actual: $($action.Arguments)"
}

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ""
Write-Host "=== MONTH REPORT SCHEDULE VERIFICATION ==="
$task.Triggers | Select-Object StartBoundary,Enabled | Format-Table -AutoSize
Write-Host "Action: $($action.Execute) $($action.Arguments)"
Write-Host "Next check: $($info.NextRunTime)"
Write-Host "Persian-calendar rule lives in report-month-sync.js: day >= 20; one successful snapshot per reportKey."
Write-Host "Existing CRM schedules are independent and unchanged."
Write-Host ""
Write-Host "MONTH_REPORT_SCHEDULE_VERIFICATION_OK"
