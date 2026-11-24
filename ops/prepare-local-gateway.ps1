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
  $dbNames = @(& $psql -X -qAt -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Username -d 'postgres' -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
  if ($LASTEXITCODE -ne 0) { throw 'Could not list local PostgreSQL databases. No .env.local was created.' }

  $orderedNames = @($Database) + @($dbNames | Where-Object { $_ -and $_ -ne $Database })
  $validDatabases = @()
  foreach ($candidate in $orderedNames) {
    $tableCheck = @(& $psql -X -qAt -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Username -d $candidate -c "SELECT (to_regclass('public.team_members') IS NOT NULL)::text || '|' || (to_regclass('public.open_leads_crm_shadow') IS NOT NULL)::text")
    if ($LASTEXITCODE -ne 0 -or ($tableCheck -join '').Trim() -ne 'true|true') { continue }
    $check = @(& $psql -X -qAt -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Username -d $candidate -c "SELECT (SELECT COUNT(*) FROM public.team_members)::text || '|' || (SELECT COUNT(*) FROM public.open_leads_crm_shadow)::text")
    if ($LASTEXITCODE -ne 0) { continue }
    $parts = (($check -join '').Trim() -split '\|')
    if ($parts.Count -eq 2 -and [long]$parts[0] -gt 0 -and [long]$parts[1] -gt 0) {
      $validDatabases += [pscustomobject]@{ Name=$candidate; TeamMembers=[long]$parts[0]; OpenLeads=[long]$parts[1] }
    }
  }

  if ($validDatabases.Count -eq 0) {
    throw 'No local database contains both public.team_members and public.open_leads_crm_shadow with data. No .env.local was created.'
  }
  if ($validDatabases.Count -gt 1) {
    $preferred = @($validDatabases | Where-Object { $_.Name -eq $Database })
    if ($preferred.Count -eq 1) { $validDatabases = $preferred }
    else {
      $choices = ($validDatabases | ForEach-Object { "$($_.Name) (team=$($_.TeamMembers), open_leads=$($_.OpenLeads))" }) -join ', '
      throw "More than one local database contains the dashboard data: $choices. Rerun with -Database specifying the intended database. No .env.local was created."
    }
  }
  $Database = $validDatabases[0].Name
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
Write-Host "PostgreSQL connection and migrated tables verified: database=$Database team_members=$($validDatabases[0].TeamMembers) open_leads=$($validDatabases[0].OpenLeads)."
Write-Host 'Secrets were written only to the ignored local .env.local file.'
Write-Host 'Keep DASHBOARD_RPC_TOKEN private; copy it into the Apps Script project Script Properties before publishing.'
