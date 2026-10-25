[CmdletBinding()]
param(
  [string]$PostgresBin = 'D:\Users\m.bashirirad\Desktop\pgsql\bin',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 55432,
  [string]$Database = 'finance_local_staging',
  [string]$Username = 'postgres'
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envFile = Join-Path $repo '.env.local'
$connectorEnv = Join-Path $repo 'connector\.env.local'
$psql = Join-Path $PostgresBin 'psql.exe'

if (Test-Path -LiteralPath $envFile) {
  throw "Refusing to overwrite existing $envFile. Keep the existing secrets and configure it manually."
}
if (-not (Test-Path -LiteralPath $connectorEnv)) {
  throw "Missing connector credentials file: $connectorEnv"
}
if (-not (Test-Path -LiteralPath $psql)) {
  throw "PostgreSQL client was not found: $psql"
}

$connectorToken = $null
foreach ($line in Get-Content -LiteralPath $connectorEnv) {
  if ($line -match '^\s*CRM_CONNECTOR_TOKEN\s*=(.*)$') {
    $connectorToken = $Matches[1].Trim().Trim('"').Trim("'")
    break
  }
}
if ([string]::IsNullOrWhiteSpace($connectorToken)) {
  throw 'CRM_CONNECTOR_TOKEN is missing from connector/.env.local.'
}

$securePassword = Read-Host 'Portable PostgreSQL password (input hidden)' -AsSecureString
$plainPassword = [Net.NetworkCredential]::new('', $securePassword).Password
if ([string]::IsNullOrEmpty($plainPassword)) { throw 'PostgreSQL password cannot be empty.' }

$env:PGPASSWORD = $plainPassword
try {
  $check = & $psql -X -qAt -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Username -d $Database -c "SELECT (SELECT COUNT(*) FROM team_members)::text || '|' || (SELECT COUNT(*) FROM open_leads_crm_shadow)::text"
  if ($LASTEXITCODE -ne 0 -or ($check -join '').Trim() -ne '80|8392') {
    throw 'Local PostgreSQL verification failed; expected 80 team members and 8392 open leads. No .env.local was created.'
  }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

function New-Secret([int]$Bytes = 32) {
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}

$encodedPassword = [Uri]::EscapeDataString($plainPassword)
$databaseUrl = "postgresql://${Username}:${encodedPassword}@${HostName}:${Port}/${Database}"
$values = @(
  "DATABASE_URL=$databaseUrl",
  'SUPABASE_DATABASE_URL=',
  "ADMIN_PASSWORD=$(New-Secret 32)",
  "CRM_CONNECTOR_TOKEN=$connectorToken",
  "DASHBOARD_RPC_TOKEN=$(New-Secret 48)"
)
[IO.File]::WriteAllText($envFile, ($values -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
$plainPassword = $null
$securePassword.Dispose()
Write-Host 'LOCAL_GATEWAY_ENV_READY'
Write-Host 'PostgreSQL connection and migrated tables verified. Secrets were written only to the ignored local .env.local file.'
Write-Host 'Keep DASHBOARD_RPC_TOKEN private; it must be copied into this Apps Script project’s Script Properties before publishing.'
