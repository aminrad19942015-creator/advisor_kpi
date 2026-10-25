[CmdletBinding()]
param(
  [int]$Port = 3000,
  [string]$CloudflareTunnelToken = $env:CLOUDFLARE_TUNNEL_TOKEN,
  [switch]$NoTunnel,
  [switch]$QuickTunnel
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
  $envText = Get-Content (Join-Path $repo '.env.local') -Raw
  $relayUrlConfigured = $envText -match '(?m)^\s*GAS_RELAY_URL\s*=\s*https://'
  $relaySecretConfigured = $envText -match '(?m)^\s*GAS_RELAY_SECRET\s*=\s*.+\S'
  if ($relayUrlConfigured -and $relaySecretConfigured) {
    $worker = Start-Process -FilePath 'node.exe' -ArgumentList @('--env-file=.env.local','connector/google-relay-worker.js') -WorkingDirectory $repo -PassThru -WindowStyle Hidden
    Write-Host "GOOGLE_RELAY_WORKER_STARTED pid=$($worker.Id)"
  } elseif ($relayUrlConfigured -or $relaySecretConfigured) {
    throw 'Google relay configuration is incomplete in .env.local; both GAS_RELAY_URL and GAS_RELAY_SECRET are required.'
  }
  if (-not $NoTunnel) {
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw 'cloudflared was not found. Install it once and run this script again.' }
    if ($QuickTunnel) {
      Write-Warning 'Quick Tunnel is temporary and intended for testing. The generated URL is public; dashboard and admin APIs still require DASHBOARD_RPC_TOKEN.'
      & cloudflared tunnel --url "http://127.0.0.1:$Port"
    } else {
      if (-not $CloudflareTunnelToken) { throw 'Set CLOUDFLARE_TUNNEL_TOKEN or pass -CloudflareTunnelToken, use -QuickTunnel for a temporary test, or use -NoTunnel.' }
      & cloudflared tunnel run --token $CloudflareTunnelToken
    }
  } else {
    Write-Host 'Tunnel disabled. Google Apps Script and Connector cannot reach this gateway until an HTTPS tunnel is configured.'
    Wait-Process -Id $backend.Id
  }
} finally { Pop-Location }
