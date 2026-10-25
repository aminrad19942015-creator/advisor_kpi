[CmdletBinding()]
param(
  [string]$TaskName = 'Advisor KPI Local Gateway',
  [int]$Port = 3010,
  [string]$User = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$startScript = Join-Path $PSScriptRoot 'start-local-gateway.ps1'
if (-not (Test-Path (Join-Path $repo '.env.local'))) { throw "Missing $repo\.env.local." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js/npm was not found.' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Port $Port -NoTunnel"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "LOCAL_GATEWAY_TASK_INSTALLED $TaskName"
Write-Host 'The HTTPS tunnel is deliberately separate; configure it as a named tunnel/service before pointing GAS at the gateway.'
