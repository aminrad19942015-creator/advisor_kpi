[CmdletBinding()]
param([switch]$Plan, [switch]$CheckAccess)
$ErrorActionPreference = 'Stop'
$arguments = @()
if ($Plan) { $arguments += '--plan' }
if ($CheckAccess) { $arguments += '--check-access' }
& node.exe (Join-Path $PSScriptRoot '../ops/deploy-gas.cjs') @arguments
exit $LASTEXITCODE
