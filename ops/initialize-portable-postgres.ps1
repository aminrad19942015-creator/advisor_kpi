[CmdletBinding()]
param(
  [string]$PostgresRoot = 'D:\Users\m.bashirirad\Desktop\pgsql',
  [string]$DataDir = 'D:\Users\m.bashirirad\Desktop\advisor-kpi-postgres-data',
  [int]$Port = 5432,
  [string]$User = 'postgres',
  [string]$Database = 'advisor_kpi',
  [string]$Password
)

$ErrorActionPreference = 'Stop'
$bin = Join-Path $PostgresRoot 'bin'
$initdb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'
foreach($tool in @($initdb,$pgCtl,$psql)){if(-not (Test-Path $tool)){throw "PostgreSQL tool not found: $tool"}}
if(-not $Password){$Password=Read-Host 'Choose the local PostgreSQL password'}
if([string]::IsNullOrWhiteSpace($Password)){throw 'A non-empty PostgreSQL password is required.'}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DataDir) | Out-Null
if(-not (Test-Path (Join-Path $DataDir 'PG_VERSION'))){
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $pwFile=Join-Path ([IO.Path]::GetTempPath()) ('advisor-kpi-pg-'+[guid]::NewGuid().ToString('N')+'.txt')
  try{
    Set-Content -LiteralPath $pwFile -Value $Password -NoNewline -Encoding UTF8
    & $initdb -D $DataDir -U $User --pwfile=$pwFile --encoding=UTF8 --locale=C
    if($LASTEXITCODE -ne 0){throw 'Portable PostgreSQL cluster initialization failed.'}
  }finally{Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue}
}

$running=& $pgCtl -D $DataDir status 2>&1
if($LASTEXITCODE -ne 0){
  & $pgCtl -D $DataDir -o "-p $Port -h 127.0.0.1" -l (Join-Path $DataDir 'server.log') start
  if($LASTEXITCODE -ne 0){throw 'Portable PostgreSQL server could not be started.'}
}
$env:PGPASSWORD=$Password
$exists=(& $psql -h 127.0.0.1 -p $Port -U $User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'").Trim()
if($exists -ne '1'){
  & $psql -h 127.0.0.1 -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$Database\""
  if($LASTEXITCODE -ne 0){throw "Could not create database '$Database'."}
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
Write-Host "PORTABLE_POSTGRES_OK data=$DataDir host=127.0.0.1 port=$Port database=$Database user=$User"
