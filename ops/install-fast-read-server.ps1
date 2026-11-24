[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$readRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$readTaskName = 'Advisor KPI Fast Read Server'
if (-not (Test-Path -LiteralPath (Join-Path $readRoot 'runtime\fast-read-build\BUILD_ID'))) {
  throw 'Build the isolated reader with ADVISOR_READ_BUILD=1 before installing this task. Do not rebuild the live connector .next directory.'
}
if (-not (Test-Path -LiteralPath (Join-Path $readRoot '.env.local'))) { throw 'The existing local gateway environment is required.' }
$gatewayTask = Get-ScheduledTask -TaskName 'Advisor KPI Local Gateway'
$readUser = $gatewayTask.Principal.UserId
$readAction = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $readRoot -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start-fast-read-server.ps1') + '"')
$readTrigger = New-ScheduledTaskTrigger -AtLogOn -User $readUser
$readPrincipal = New-ScheduledTaskPrincipal -UserId $readUser -LogonType Interactive -RunLevel Limited
$readSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$existingReader = Get-ScheduledTask -TaskName $readTaskName -ErrorAction SilentlyContinue
if ($existingReader -and ($existingReader.Actions.Arguments -notlike ('*' + (Join-Path $PSScriptRoot 'start-fast-read-server.ps1') + '*'))) { throw 'A different task uses this name; inspect it before replacement.' }
Register-ScheduledTask -TaskName $readTaskName -Action $readAction -Trigger $readTrigger -Principal $readPrincipal -Settings $readSettings -Force | Out-Null
& (Join-Path $PSScriptRoot 'enable-runtime-recovery.ps1') -TaskName $readTaskName
Start-ScheduledTask -TaskName $readTaskName
Write-Output 'FAST_READ_TASK_READY; existing PostgreSQL, CRM tasks and gateway were not stopped.'
Write-Output 'Verify the authenticated reader on 127.0.0.1:3012 before setting runtime/fast-read-ready.json to {"port":3012} and restarting only the dashboard relay worker.'
