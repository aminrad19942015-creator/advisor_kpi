[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GatewayUrl,
  [string]$ConnectorDir = (Join-Path $PSScriptRoot '..\connector')
)

$ErrorActionPreference = 'Stop'
$envPath = Join-Path ([IO.Path]::GetFullPath($ConnectorDir)) '.env.local'
if (-not (Test-Path $envPath)) { throw "Missing connector .env.local: $envPath" }
$base = $GatewayUrl.TrimEnd('/')
if (-not $base.StartsWith('https://')) { throw 'GatewayUrl must be an HTTPS URL reachable by Google Apps Script.' }

$values = [ordered]@{
  DASHBOARD_API_URL = "$base/api/crm-shadow"
  DASHBOARD_ACTIVITY_API_URL = "$base/api/crm-activity"
  DASHBOARD_CRM_CONFIG_URL = "$base/api/crm-config"
  DASHBOARD_CONNECTOR_COMMAND_URL = "$base/api/connector-command"
}
$lines = [Collections.Generic.List[string]]::new()
$seen = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  $key = if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=') { $Matches[1] } else { '' }
  if ($values.Contains($key)) { $lines.Add("$key=$($values[$key])"); $seen[$key]=$true } else { $lines.Add($line) }
}
foreach ($key in $values.Keys) { if (-not $seen.ContainsKey($key)) { $lines.Add("$key=$($values[$key])") } }
Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8
Write-Host "CONNECTOR_LOCAL_GATEWAY_CONFIGURED $base"
Write-Host 'Scheduled Connector tasks remain disabled until the database and dashboard cutover is verified.'
