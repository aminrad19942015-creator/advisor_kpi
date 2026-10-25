[CmdletBinding()]
param(
  [string]$HostName = '127.0.0.1',
  [int]$Port = 55432,
  [string]$User = 'postgres',
  [string]$Database = 'advisor_kpi',
  [string]$Password,
  [string]$PostgresBin
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

if (-not $Password) { $Password = Read-Host 'Portable PostgreSQL password' }
$psql = Resolve-PgTool 'psql'
$env:PGPASSWORD = $Password

& $psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -tAc "SELECT 1" *> $null
if ($LASTEXITCODE -ne 0) { throw "Cannot connect to PostgreSQL at ${HostName}:${Port}." }

$exists = (& $psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'").Trim()
if ($exists -ne '1') {
  & $psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$Database\""
  if ($LASTEXITCODE -ne 0) { throw "Could not create database '$Database'." }
}

Write-Host "LOCAL_POSTGRES_OK database=$Database host=$HostName port=$Port"
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
