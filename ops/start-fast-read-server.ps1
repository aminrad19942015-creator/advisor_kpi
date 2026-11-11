$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $repoPath
& node.exe (Join-Path $PSScriptRoot 'fast-read-server.cjs')
exit $LASTEXITCODE
