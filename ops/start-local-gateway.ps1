[CmdletBinding()]
param(
  [int]$Port = 3000,
  [string]$CloudflareTunnelToken = $env:CLOUDFLARE_TUNNEL_TOKEN,
  [switch]$NoTunnel
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Test-Path (Join-Path $repo '.env.local'))) { throw "Missing $repo\.env.local. Copy .env.example and set DATABASE_URL, ADMIN_PASSWORD, CRM_CONNECTOR_TOKEN, and DASHBOARD_RPC_TOKEN." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js/npm was not found.' }

Push-Location $repo
try {
  if (-not (Test-Path (Join-Path $repo '.next'))) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Next.js build failed.' }
  }
  $backend = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','start','--','-p',[string]$Port) -WorkingDirectory $repo -PassThru -WindowStyle Hidden
  Write-Host "LOCAL_GATEWAY_STARTED pid=$($backend.Id) http://127.0.0.1:$Port"
  if (-not $NoTunnel) {
    if (-not $CloudflareTunnelToken) { throw 'Set CLOUDFLARE_TUNNEL_TOKEN or pass -CloudflareTunnelToken, or use -NoTunnel.' }
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw 'cloudflared was not found. Install it once and run this script again.' }
    & cloudflared tunnel run --token $CloudflareTunnelToken
  } else {
    Write-Host 'Tunnel disabled. Google Apps Script and Connector cannot reach this gateway until an HTTPS tunnel is configured.'
    Wait-Process -Id $backend.Id
  }
} finally { Pop-Location }
