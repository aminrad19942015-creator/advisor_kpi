$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runCmd = Join-Path $connectorDir "run-activity.cmd"
$taskName = "Advisor CRM Activity Sync"
$legacyTaskNames = @(
  "Advisor CRM Morning Sync",
  "Advisor CRM Historical Activity Sync"
)

if (-not (Test-Path $runCmd)) { throw "run-activity.cmd not found." }

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c ""' + $runCmd + '""')
$days = @("Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday")
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At "07:30"
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

foreach ($legacy in $legacyTaskNames) {
  if (Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $legacy -Confirm:$false
  }
}

Write-Host "Scheduled task installed: $taskName"
Write-Host "Activity (Lead/Opportunity, Calls, Tickets): Saturday-Thursday at 07:30. Friday is disabled."
