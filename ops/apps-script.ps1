[CmdletBinding()]
param(
  [ValidateSet('dashboard','relay')][string]$Project = 'dashboard',
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$ClaspArgs
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cli = Join-Path $env:LOCALAPPDATA 'AdvisorKpiTools\clasp\node_modules\@google\clasp\build\src\index.js'
if (-not (Test-Path -LiteralPath $cli)) { throw 'The official clasp tool is not installed in the current user tools directory.' }
$stage = Join-Path $repo ('runtime\gas-' + $Project + '-deploy')
if (-not (Test-Path -LiteralPath (Join-Path $stage '.clasp.json'))) { throw 'Stage the Google project first with ops/stage-google-project.cjs.' }
Push-Location $stage
try { & node.exe $cli @ClaspArgs; exit $LASTEXITCODE } finally { Pop-Location }
