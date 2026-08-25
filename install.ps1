$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'PowerShell 5 or newer is required.' }
$node = node --version
if ([version]($node.TrimStart('v')) -lt [version]'22.12.0') {
  throw "Node.js 22.12+ is required (found $node)."
}

Write-Host 'Installing locked Tok-kie dependencies...'
npm ci
Push-Location dashboard
npm ci
Pop-Location
npm run build
Write-Host 'Tok-kie installation complete. Start with: npm run dev'
