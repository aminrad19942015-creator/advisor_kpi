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

function Download-ConnectorFile([string]$Uri, [string]$Target) {
  $temporary = "$Target.download"
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $temporary -TimeoutSec 120
  }
  catch {
    Write-Host "PowerShell download failed; retrying with curl.exe ..."
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
      throw
    }

    & curl.exe --fail --silent --show-error --location --http1.1 `
      --retry 5 --retry-delay 2 --retry-all-errors `
      --connect-timeout 20 --max-time 120 `
      --output $temporary $Uri
    if ($LASTEXITCODE -ne 0) {
      throw "curl.exe failed while downloading $Uri with exit code $LASTEXITCODE."
    }
  }

  if (-not (Test-Path -LiteralPath $temporary)) {
    throw "Download did not create a file: $Uri"
  }
  Move-Item -LiteralPath $temporary -Destination $Target -Force
}

foreach ($file in $files) {
  Write-Host "Downloading $file ..."
  Download-ConnectorFile "$base/$file" (Join-Path $connectorDir $file)
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
