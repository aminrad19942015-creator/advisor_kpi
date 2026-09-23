$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runCmd = Join-Path $connectorDir "run-history.cmd"
$taskName = "Advisor CRM Historical Activity Sync"

if (-not (Test-Path $runCmd)) { throw "run-history.cmd not found." }

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c ""' + $runCmd + '""')
$trigger = New-ScheduledTaskTrigger -Daily -At "07:00"
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Scheduled task installed: $taskName"
Write-Host "Historical Lead / Opportunity / Calls / Ticket refresh once daily at 07:00."
