[CmdletBinding()]
param(
  [string]$PostgresBin = 'D:\Users\m.bashirirad\Desktop\pgsql\bin',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 55432,
  [string]$Database = 'finance_local_staging',
  [string]$Username = 'postgres',
  [string]$DumpFile
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($DumpFile)) {
  $DumpFile = Join-Path $scriptDirectory '..\runtime\postgres-migration\supabase-public.dump'
}
$resolvedHost = $HostName.Trim().ToLowerInvariant()
$isLoopback = $resolvedHost -eq 'localhost'
if (-not $isLoopback) {
  $parsedAddress = [Net.IPAddress]::Any
  if ([Net.IPAddress]::TryParse($resolvedHost, [ref]$parsedAddress)) {
    $isLoopback = [Net.IPAddress]::IsLoopback($parsedAddress)
  }
}
if (-not $isLoopback) { throw 'This restore helper only permits a local loopback PostgreSQL host.' }

$dumpPath = [IO.Path]::GetFullPath($DumpFile)
if (-not (Test-Path -LiteralPath $dumpPath)) { throw "Verified dump was not found: $dumpPath" }

$psql = Join-Path $PostgresBin 'psql.exe'
$pgDump = Join-Path $PostgresBin 'pg_dump.exe'
$pgRestore = Join-Path $PostgresBin 'pg_restore.exe'
foreach ($toolPath in @($psql, $pgDump, $pgRestore)) {
  if (-not (Test-Path -LiteralPath $toolPath)) { throw "PostgreSQL tool was not found: $toolPath" }
}

$securePassword = Read-Host 'Portable PostgreSQL password (input hidden)' -AsSecureString
$plainPassword = [Net.NetworkCredential]::new('', $securePassword).Password
if ([string]::IsNullOrEmpty($plainPassword)) { throw 'PostgreSQL password cannot be empty.' }
$env:PGPASSWORD = $plainPassword

try {
  $identity = @(& $psql -X -qAt -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Username -d $Database -c "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text,'local-socket') || '|' || inet_server_port()::text")
  if ($LASTEXITCODE -ne 0) { throw "Could not connect to local PostgreSQL database '$Database' on port $Port. No restore was attempted." }
  $identityParts = (($identity -join '').Trim() -split '\|')
  if ($identityParts.Count -ne 3 -or $identityParts[0] -ne $Database -or [int]$identityParts[2] -ne $Port) {
    throw "Connected server identity did not match the requested local target ($Database on port $Port). No restore was attempted."
  }
  Write-Host "Verified local target: database=$($identityParts[0]) address=$($identityParts[1]) port=$($identityParts[2])"

  $backupPath = "$dumpPath.before-local-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
  Write-Host 'Backing up the current local database before restore ...'
  & $pgDump -h $HostName -p $Port -U $Username -d $Database --schema=public --format=custom --no-owner --no-privileges --file=$backupPath
  if ($LASTEXITCODE -ne 0) { throw 'Local backup failed. Restore was not attempted.' }

  Write-Host 'Restoring the existing verified dump to the local database ...'
  & $pgRestore -h $HostName -p $Port -U $Username -d $Database --clean --if-exists --no-owner --no-privileges --exit-on-error $dumpPath
  if ($LASTEXITCODE -ne 0) { throw "Local restore failed. The pre-restore backup is at $backupPath" }

  $counts = @(& $psql -X -qAt -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Username -d $Database -c "SELECT (SELECT COUNT(*) FROM public.team_members)::text || '|' || (SELECT COUNT(*) FROM public.open_leads_crm_shadow)::text")
  if ($LASTEXITCODE -ne 0) { throw "Post-restore verification failed. The pre-restore backup is at $backupPath" }
  $countParts = (($counts -join '').Trim() -split '\|')
  if ($countParts.Count -ne 2 -or [long]$countParts[0] -le 0 -or [long]$countParts[1] -le 0) {
    throw "Post-restore verification found no dashboard data. The pre-restore backup is at $backupPath"
  }

  Write-Host "LOCAL_POSTGRES_RESTORE_OK database=$Database team_members=$($countParts[0]) open_leads=$($countParts[1])"
  Write-Host "Rollback backup: $backupPath"
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $plainPassword = $null
  $securePassword.Dispose()
}
