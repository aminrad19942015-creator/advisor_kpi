$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runCmd = Join-Path $connectorDir "run-month-report.cmd"
$taskName = "Advisor CRM Previous Month Report Sync"

if (-not (Test-Path $runCmd)) { throw "run-month-report.cmd not found." }

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c ""' + $runCmd + '""')
# The Windows trigger is daily because Task Scheduler is Gregorian.
# report-month-sync.js performs the Persian-calendar guard and only contacts CRM
# on Persian day 20 or later when that month's previous-month snapshot is not current.
$trigger = New-ScheduledTaskTrigger -Daily -At "15:30"
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Scheduled task installed: $taskName"
Write-Host "Check time: daily at 15:30 Tehran/company-PC time."
Write-Host "CRM fetch rule: Persian day >= 20 AND previous-Persian-month report is not already current."
Write-Host "Existing 07:00 / 09:00 / 12:00 / 15:00 tasks were not modified."
