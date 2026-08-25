$ErrorActionPreference = 'Stop'
$CurrentDataDir = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Tok-kie'
$LegacyDataDir = Join-Path $env:USERPROFILE '.agent-token-tracker'
$AllowedDataDirs = @($CurrentDataDir, $LegacyDataDir)

Write-Host 'Tok-kie does not install a background service.'
Write-Host "Current Electron data: $CurrentDataDir"
Write-Host "Legacy data: $LegacyDataDir"
$answer = Read-Host 'Delete all listed local settings, databases, backups, and logs? (y/N)'
if ($answer -match '^[Yy]$') {
  foreach ($Target in $AllowedDataDirs) {
    if ($Target -notin $AllowedDataDirs) { throw "Refusing unsafe deletion target: $Target" }
    if (Test-Path -LiteralPath $Target -PathType Container) {
      Remove-Item -LiteralPath $Target -Recurse -Force
    }
  }
  Write-Host 'Tok-kie current and legacy user data deleted. This cannot be undone.'
} else {
  Write-Host 'User data was preserved.'
}
Write-Host 'Remove the application itself from Windows Settings > Installed apps (NSIS uninstaller).'
