param(
  [string]$Url = "",
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "claude-bridge-mcp-stdio.mjs"
if (-not (Test-Path $scriptPath)) {
  throw "MCP stdio script not found: $scriptPath"
}

$args = @($scriptPath)
if ($Url -and $Url.Trim()) {
  $args += @("--url", $Url.Trim())
}
if ($Token -and $Token.Trim()) {
  $args += @("--token", $Token.Trim())
}

& node @args
exit $LASTEXITCODE

