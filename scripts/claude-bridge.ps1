param(
  [string]$Url = "",
  [string]$Token = "",
  [string]$Project = "",
  [string]$ClaudeBin = "claude",
  [string]$Prompt = "",
  [int]$BatchSize = 24,
  [switch]$Help,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ClaudeArgs
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Claude bridge launcher (PowerShell)

Usage:
  ./scripts/claude-bridge.ps1 [options] -- [claude args...]

Options:
  -Url <baseUrl>         Default: LOCAL_LLM_INTEGRATION_URL or http://127.0.0.1:17373
  -Token <bearerToken>   Default: LOCAL_LLM_INTEGRATION_TOKEN
  -Project <path>        Default: current directory
  -ClaudeBin <bin>       Default: claude
  -Prompt <text>         Optional explicit prompt event
  -BatchSize <n>         Default: 24
  -Help

Examples:
  ./scripts/claude-bridge.ps1 -- --print
  ./scripts/claude-bridge.ps1 -Token "YOUR_TOKEN" -Project "C:\repo" -- --print
  ./scripts/claude-bridge.ps1 -Prompt "Summarize this repo" -- --print
"@ | Write-Host
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$wrapperPath = Join-Path $PSScriptRoot "claude-code-bridge-wrapper.mjs"

if (-not (Test-Path $wrapperPath)) {
  throw "Wrapper script not found: $wrapperPath"
}

$resolvedUrl = if ($Url -and $Url.Trim()) {
  $Url.Trim()
} elseif ($env:LOCAL_LLM_INTEGRATION_URL -and $env:LOCAL_LLM_INTEGRATION_URL.Trim()) {
  $env:LOCAL_LLM_INTEGRATION_URL.Trim()
} else {
  "http://127.0.0.1:17373"
}

$resolvedToken = if ($Token -and $Token.Trim()) {
  $Token.Trim()
} elseif ($env:LOCAL_LLM_INTEGRATION_TOKEN -and $env:LOCAL_LLM_INTEGRATION_TOKEN.Trim()) {
  $env:LOCAL_LLM_INTEGRATION_TOKEN.Trim()
} else {
  ""
}

$resolvedProject = if ($Project -and $Project.Trim()) {
  $Project.Trim()
} else {
  (Get-Location).Path
}

$nodeArgs = @(
  $wrapperPath,
  "--url", $resolvedUrl,
  "--project", $resolvedProject,
  "--claude-bin", $ClaudeBin,
  "--batch-size", "$BatchSize"
)

if ($resolvedToken) {
  $nodeArgs += @("--token", $resolvedToken)
}

if ($Prompt -and $Prompt.Trim()) {
  $nodeArgs += @("--prompt", $Prompt.Trim())
}

$nodeArgs += "--"
if ($ClaudeArgs) {
  $nodeArgs += $ClaudeArgs
}

Push-Location $repoRoot
try {
  & node @nodeArgs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}

