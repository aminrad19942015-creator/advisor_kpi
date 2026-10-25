[CmdletBinding()]
param(
  [string]$SourceUrl = $env:ADVISOR_SOURCE_DATABASE_URL,
  [string]$TargetUrl = $env:ADVISOR_TARGET_DATABASE_URL,
  [string]$PostgresBin,
  [string]$DumpFile = (Join-Path $PSScriptRoot '..\runtime\postgres-migration\supabase-public.dump')
)

$ErrorActionPreference = 'Stop'

function Resolve-PgTool([string]$Name) {
  if ($PostgresBin) {
    $candidate = Join-Path $PostgresBin $Name
    if (Test-Path $candidate) { return $candidate }
    if (Test-Path "$candidate.exe") { return "$candidate.exe" }
  }
  $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "PostgreSQL tool '$Name' was not found. Pass -PostgresBin pointing to the PostgreSQL bin folder."
}

if (-not $SourceUrl) { $SourceUrl = Read-Host 'Read-only Supabase PostgreSQL connection URL' }
if (-not $TargetUrl) { $TargetUrl = Read-Host 'Local portable PostgreSQL connection URL' }
if (-not $SourceUrl -or -not $TargetUrl) { throw 'Both source and target connection URLs are required.' }

$pgDump = Resolve-PgTool 'pg_dump'
$pgRestore = Resolve-PgTool 'pg_restore'
$psql = Resolve-PgTool 'psql'
$dumpPath = [IO.Path]::GetFullPath($DumpFile)
$dumpDir = Split-Path -Parent $dumpPath
New-Item -ItemType Directory -Force -Path $dumpDir | Out-Null

Write-Host 'Creating a read-only public-schema dump from Supabase ...'
& $pgDump --dbname=$SourceUrl --schema=public --format=custom --no-owner --no-privileges --file=$dumpPath
if ($LASTEXITCODE -ne 0) { throw 'Supabase dump failed. No local data was changed.' }

$backupPath = "$dumpPath.before-restore.dump"
Write-Host 'Backing up the current local database before restore ...'
& $pgDump --dbname=$TargetUrl --schema=public --format=custom --no-owner --no-privileges --file=$backupPath
if ($LASTEXITCODE -ne 0) { throw 'Local backup failed. Restore was not attempted.' }

Write-Host 'Restoring the verified dump into local PostgreSQL ...'
& $pgRestore --dbname=$TargetUrl --clean --if-exists --no-owner --no-privileges --exit-on-error $dumpPath
if ($LASTEXITCODE -ne 0) { throw "Local restore failed. The pre-restore backup is at $backupPath" }

$checks = @(
  "SELECT 'team_members' AS table_name,COUNT(*)::bigint AS rows FROM public.team_members",
  "SELECT 'open_leads' AS table_name,COUNT(*)::bigint AS rows FROM public.open_leads",
  "SELECT 'daily_leads' AS table_name,COUNT(*)::bigint AS rows FROM public.daily_leads",
  "SELECT 'monthly_leads' AS table_name,COUNT(*)::bigint AS rows FROM public.monthly_leads",
  "SELECT 'monthly_calls' AS table_name,COUNT(*)::bigint AS rows FROM public.monthly_calls",
  "SELECT 'monthly_tickets' AS table_name,COUNT(*)::bigint AS rows FROM public.monthly_tickets",
  "SELECT key,value FROM public.dashboard_meta WHERE key IN ('data_version','last_sync_at','crm_shadow_last_sync_at','crm_activity_last_sync_at') ORDER BY key"
)
Write-Host 'Verifying essential tables and metadata ...'
foreach ($sql in $checks) {
  & $psql --dbname=$TargetUrl --set=ON_ERROR_STOP=1 --tuples-only --command=$sql
  if ($LASTEXITCODE -ne 0) { throw "Verification failed. The pre-restore backup is at $backupPath" }
}

Write-Host 'LOCAL_POSTGRES_MIGRATION_OK'
Write-Host "Dump: $dumpPath"
Write-Host "Rollback backup: $backupPath"
