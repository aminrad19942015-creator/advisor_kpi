$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runCmd = Join-Path $connectorDir "run.cmd"
$taskName = "Advisor CRM Open Leads Sync"

if (-not (Test-Path $runCmd)) {
  throw "run.cmd not found."
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c ""' + $runCmd + '""')
$days = @("Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday")
$triggers = @(
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At "07:00"
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At "09:00"
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At "12:00"
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At "15:00"
)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Scheduled task installed: $taskName"
Write-Host "Open Leads: Saturday-Thursday at 07:00, 09:00, 12:00 and 15:00. Friday is disabled."
