param(
  [string]$Root = $env:USERPROFILE
)

$ErrorActionPreference = "SilentlyContinue"
Write-Host "Searching for Advisor KPI Connector under: $Root"
Write-Host ""

$candidates = Get-ChildItem -Path $Root -Filter ".env.local" -File -Recurse -Force |
  ForEach-Object {
    $dir = $_.Directory.FullName
    $package = Join-Path $dir "package.json"
    $sync = Join-Path $dir "sync.js"
    if ((Test-Path $package) -and (Test-Path $sync)) {
      try {
        $json = Get-Content -LiteralPath $package -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([string]$json.name -eq "advisor-crm-connector") {
          [pscustomobject]@{
            ConnectorDir = $dir
            EnvFile = $_.FullName
            Package = [string]$json.name
          }
        }
      } catch {}
    }
  }

$candidates = @($candidates | Sort-Object ConnectorDir -Unique)

if ($candidates.Count -eq 0) {
  Write-Host "CONNECTOR_NOT_FOUND"
  exit 2
}

$candidates | Format-Table -AutoSize

if ($candidates.Count -eq 1) {
  Write-Host ""
  Write-Host ("CONNECTOR_DIR=" + $candidates[0].ConnectorDir)
} else {
  Write-Host ""
  Write-Host "More than one Connector folder was found. Use the folder that contains the active .env.local."
}
