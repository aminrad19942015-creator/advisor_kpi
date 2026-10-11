$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $connectorDir ".env.local"

if (-not (Test-Path $envFile)) {
  throw ".env.local not found."
}

$envMap = @{}
Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -le 0) { return }
  $name = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1)
  $envMap[$name] = $value
}

$token = [string]$envMap["CRM_CONNECTOR_TOKEN"]
if (-not $token) {
  throw "CRM_CONNECTOR_TOKEN is missing from .env.local."
}

$required = @(
  "DASHBOARD_API_URL",
  "DASHBOARD_ACTIVITY_API_URL",
  "DASHBOARD_CRM_CONFIG_URL",
  "DASHBOARD_CONNECTOR_COMMAND_URL"
)

foreach ($name in $required) {
  if (-not $envMap[$name]) { throw "$name is missing from .env.local." }
  if (-not ([string]$envMap[$name]).StartsWith("https://tdsqkxyqmebyufcmskkm.supabase.co/functions/v1/connector-api/")) {
    throw "$name is not pointing to the Supabase connector-api."
  }
}

$headers = @{ "x-crm-connector-token" = $token }
$checks = @(
  @{ Name = "CRM config"; Url = [string]$envMap["DASHBOARD_CRM_CONFIG_URL"] },
  @{ Name = "Open Leads status"; Url = [string]$envMap["DASHBOARD_API_URL"] },
  @{ Name = "Activity status"; Url = [string]$envMap["DASHBOARD_ACTIVITY_API_URL"] },
  @{ Name = "Connector command"; Url = [string]$envMap["DASHBOARD_CONNECTOR_COMMAND_URL"] }
)

foreach ($check in $checks) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $check.Url -Headers $headers -Method GET -TimeoutSec 30
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "HTTP $($response.StatusCode)"
    }
    $json = $response.Content | ConvertFrom-Json
    if (-not $json.ok) { throw "Response ok=false" }
    Write-Host ("OK  " + $check.Name)
  }
  catch {
    Write-Host ("FAIL " + $check.Name + ": " + $_.Exception.Message)
    throw "Supabase connector endpoint verification failed."
  }
}

Write-Host ""
Write-Host "All Supabase connector endpoints are healthy."
