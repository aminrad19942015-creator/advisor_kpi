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

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $bytes = [Text.Encoding]::UTF8.GetBytes($token)
  $hash = $sha.ComputeHash($bytes)
  $hex = -join ($hash | ForEach-Object { $_.ToString("x2") })
  Write-Host "CRM_CONNECTOR_TOKEN_SHA256=$hex"
} finally {
  $sha.Dispose()
}
