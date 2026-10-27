[CmdletBinding()]
param([string[]]$TaskName = @('Advisor KPI Local Gateway','Advisor KPI Fast Read Server'))
$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach ($runtimeTaskName in $TaskName) {
  if ($runtimeTaskName -notin @('Advisor KPI Local Gateway','Advisor KPI Fast Read Server')) { throw 'Only Advisor KPI runtime tasks may be changed.' }
  $runtimeTask = Get-ScheduledTask -TaskName $runtimeTaskName -ErrorAction Stop
  $expectedScript = if ($runtimeTaskName -eq 'Advisor KPI Local Gateway') { 'start-local-gateway.ps1' } else { 'start-fast-read-server.ps1' }
  if (@($runtimeTask.Actions).Count -ne 1 -or $runtimeTask.Actions.Arguments -notlike ('*' + (Join-Path $PSScriptRoot $expectedScript) + '*')) { throw 'Unexpected runtime task action; no settings were changed for this task.' }
  if ([string]$runtimeTask.Principal.RunLevel -ne 'Limited') { throw 'A current-user, non-admin runtime task is required.' }
  # Logon alone does not recover a process terminated later in the same session.
  # Repeating starts are ignored while the existing instance is still running.
  $runtimeRecovery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 2)
  $runtimeRecovery.Id = 'AdvisorRuntimeRecovery'
  $runtimeTriggers = @($runtimeTask.Triggers | Where-Object { $_.Id -ne 'AdvisorRuntimeRecovery' }) + @($runtimeRecovery)
  $runtimeSettings = $runtimeTask.Settings
  $runtimeSettings.StartWhenAvailable = $true
  $runtimeSettings.DisallowStartIfOnBatteries = $false
  $runtimeSettings.StopIfGoingOnBatteries = $false
  $runtimeSettings.ExecutionTimeLimit = 'PT0S'
  $runtimeSettings.MultipleInstances = 2 # IgnoreNew
  $runtimeSettings.RestartCount = 10
  $runtimeSettings.RestartInterval = 'PT1M'
  Set-ScheduledTask -TaskName $runtimeTaskName -TaskPath $runtimeTask.TaskPath -Trigger $runtimeTriggers -Settings $runtimeSettings | Out-Null
  Write-Output ('RUNTIME_RECOVERY_READY task=' + $runtimeTaskName + ' interval=2m; existing instances and CRM tasks were not stopped.')
}
