$ErrorActionPreference = "Stop"
$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $connectorDir ".env.local"

if (-not (Test-Path $envFile)) {
  throw ".env.local not found in connector folder."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $connectorDir (".env.local.before-supabase-" + $timestamp + ".bak")
Copy-Item -LiteralPath $envFile -Destination $backup -Force

$base = "https://tdsqkxyqmebyufcmskkm.supabase.co/functions/v1/connector-api"
$values = [ordered]@{
  "DASHBOARD_API_URL" = "$base/crm-shadow"
  "DASHBOARD_ACTIVITY_API_URL" = "$base/crm-activity"
  "DASHBOARD_CRM_CONFIG_URL" = "$base/crm-config"
  "DASHBOARD_CONNECTOR_COMMAND_URL" = "$base/connector-command"
}

$lines = Get-Content -LiteralPath $envFile -Encoding UTF8
foreach ($name in $values.Keys) {
  $value = $values[$name]
  $pattern = "^[ ]*" + [regex]::Escape($name) + "="
  $found = $false

  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = "$name=$value"
      $found = $true
      break
    }
  }

  if (-not $found) {
    $lines += "$name=$value"
  }
}

[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Connector endpoint cutover prepared."
Write-Host "Backup: $backup"
Write-Host "Destination: Supabase connector-api"
Write-Host ""
Write-Host "Verifying endpoints..."
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $connectorDir "verify-supabase-endpoints.ps1")
