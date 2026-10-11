$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $connectorDir ".env.local"

if (-not (Test-Path $envFile)) {
  throw ".env.local not found."
}

$line = Get-Content -LiteralPath $envFile -Encoding UTF8 |
  Where-Object { $_ -match "^[ ]*CRM_CONNECTOR_TOKEN=" } |
  Select-Object -First 1

if (-not $line) {
  throw "CRM_CONNECTOR_TOKEN is missing from .env.local."
}

$token = $line.Substring($line.IndexOf("=") + 1)
if (-not $token) {
  throw "CRM_CONNECTOR_TOKEN is empty."
}

$url = "https://tdsqkxyqmebyufcmskkm.supabase.co/functions/v1/connector-api/crm-config"
$headers = @{ "x-crm-connector-token" = $token }

try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -Method GET -TimeoutSec 30
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
    throw "HTTP $($response.StatusCode)"
  }
  $json = $response.Content | ConvertFrom-Json
  if (-not $json.ok) { throw "Response ok=false" }
  Write-Host "SUPABASE_CONNECTOR_AUTH_OK"
} catch {
  Write-Host ("SUPABASE_CONNECTOR_AUTH_FAILED: " + $_.Exception.Message)
  exit 1
}
