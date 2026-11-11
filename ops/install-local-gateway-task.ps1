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

$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -Port $Port -NoTunnel"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  if ($TaskName -eq 'Advisor KPI Local Gateway') { & (Join-Path $PSScriptRoot 'enable-runtime-recovery.ps1') -TaskName $TaskName }
  Write-Host "LOCAL_GATEWAY_TASK_INSTALLED $TaskName"
} catch {
  $startup = [Environment]::GetFolderPath('Startup')
  $shortcutPath = Join-Path $startup 'Advisor KPI Local Gateway.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $repo
  $shortcut.Save()
  Write-Host "LOCAL_GATEWAY_STARTUP_INSTALLED $shortcutPath"
}
Write-Host 'The current-user runtime starts the loopback gateway and outbound Google worker without administrator access or a public port.'
