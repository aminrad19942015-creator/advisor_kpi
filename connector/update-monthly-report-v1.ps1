$ErrorActionPreference = 'Stop'

$connectorDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $connectorDir

if (-not (Test-Path (Join-Path $connectorDir '.env.local'))) {
  throw "Missing .env.local in $connectorDir. Copy .env.example and configure CRM credentials first."
}

$releaseRef = '55c6a601a45533b48ff898b81d8d40883e9f283b'
$base = "https://raw.githubusercontent.com/aminrad19942015-creator/advisor_kpi/$releaseRef/connector"
$files = @(
  'package.json',
  'sync.js',
  'activity-sync.js',
  'dashboard-http.js',
  'upload-client.js',
  'test-upload-client.js',
  'lead-opportunity-sync.js',
  'calls-sync.js',
  'tickets-sync.js'
)

Write-Host "Updating Connector from advisor_kpi commit $releaseRef ..."
foreach ($file in $files) {
  Write-Host "Downloading $file ..."
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile (Join-Path $connectorDir $file)
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'Node.js/npm was not found. Install Node.js 20+ and run this updater again.'
}

Write-Host ''
Write-Host 'Installing connector dependencies ...'
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }

Write-Host ''
Write-Host 'Verifying safe upload chunks ...'
npm run test:upload
if ($LASTEXITCODE -ne 0) { throw "Upload-client verification failed with exit code $LASTEXITCODE." }

Write-Host ''
Write-Host 'CONNECTOR_UPDATE_OK'
Write-Host "Release: $releaseRef"
Write-Host 'The existing .env.local and runtime snapshots were preserved.'
