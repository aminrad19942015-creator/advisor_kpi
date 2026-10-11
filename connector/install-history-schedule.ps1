$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runCmd = Join-Path $connectorDir "run-morning.cmd"
$taskName = "Advisor CRM Morning Sync"
$legacyTaskName = "Advisor CRM Historical Activity Sync"

if (-not (Test-Path $runCmd)) { throw "run-morning.cmd not found." }

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c ""' + $runCmd + '""')
$days = @("Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday")
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At "07:00"
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

if (Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
}

Write-Host "Scheduled task installed: $taskName"
Write-Host "Morning Open Leads + Lead/Opportunity/Calls/Ticket history: Saturday-Thursday at 07:00. Friday is disabled."
