$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runCmd = Join-Path $connectorDir "run.cmd"
$taskName = "Advisor CRM Open Leads Sync"

if (-not (Test-Path $runCmd)) {
  throw "run.cmd not found."
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c ""' + $runCmd + '""')
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Scheduled task installed: $taskName"
Write-Host "Runs every 30 minutes while this Windows user is logged in."
