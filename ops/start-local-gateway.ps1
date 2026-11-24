[CmdletBinding()]
param(
  [int]$Port = 3010,
  [switch]$NoTunnel
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Test-Path (Join-Path $repo '.env.local'))) { throw "Missing $repo\.env.local. Copy .env.example and set DATABASE_URL, ADMIN_PASSWORD, CRM_CONNECTOR_TOKEN, and DASHBOARD_RPC_TOKEN." }
$node = (Get-Command node.exe -ErrorAction Stop).Source

Push-Location $repo
try {
  if (-not (Test-Path (Join-Path $repo '.next\BUILD_ID'))) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Next.js build failed.' }
  }
  $env:LOCAL_GATEWAY_PORT = [string]$Port
  & $node (Join-Path $PSScriptRoot 'local-runtime.cjs')
  exit $LASTEXITCODE
} finally { Pop-Location }
