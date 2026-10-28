[CmdletBinding()]
param(
  [string]$ProjectRoot,
  [string]$DesktopDirectory,
  [string]$IconDirectory,

  # Forwarded to the launcher only when given (the launcher tests, and the
  # throwaway port-3002 check); a normal install keeps the launcher defaults.
  [ValidateRange(1, 65535)]
  [int]$Port = 3001,
  [string]$ChromeUserDataDirectory,

  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-DesktopDirectory {
  if (-not [string]::IsNullOrWhiteSpace($DesktopDirectory)) {
    return [Environment]::ExpandEnvironmentVariables($DesktopDirectory)
  }

  $candidate = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::DesktopDirectory
  )
  if (-not [string]::IsNullOrWhiteSpace($candidate)) {
    return $candidate
  }

  try {
    $shell = New-Object -ComObject WScript.Shell
    $candidate = [string]$shell.SpecialFolders.Item('Desktop')
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      return $candidate
    }
  } catch {
    # Some stripped-down Windows sessions expose the shell path only in HKCU.
  }

  $shellFolders = Get-ItemProperty -LiteralPath `
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
  $candidate = [Environment]::ExpandEnvironmentVariables([string]$shellFolders.Desktop)
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    throw 'Windows did not provide a Desktop folder for the current user.'
  }

  return $candidate
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

$launcherPath = Join-Path $ProjectRoot 'scripts\Start-Lokr.ps1'
$iconPath = Join-Path $ProjectRoot 'public\lokr.ico'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "The Lokr launcher is missing: $launcherPath"
}
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  throw "The Windows icon is missing: $iconPath"
}

if (-not $SkipBuild) {
  $pnpmCommand = Get-Command pnpm.cmd -CommandType Application -ErrorAction Stop |
    Select-Object -First 1
  Push-Location -LiteralPath $ProjectRoot
  try {
    & $pnpmCommand.Source build
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm build failed with exit code $LASTEXITCODE. The Desktop shortcut was not changed."
    }
  } finally {
    Pop-Location
  }
}

$buildIdPath = Join-Path $ProjectRoot '.next\BUILD_ID'
if (-not (Test-Path -LiteralPath $buildIdPath -PathType Leaf)) {
  throw 'The production build is missing. The Desktop shortcut was not changed.'
}

$iconHash = (Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($IconDirectory)) {
  $localAppData = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::LocalApplicationData
  )
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw 'Windows did not provide a local application-data folder for the icon cache.'
  }
  $IconDirectory = Join-Path $localAppData 'Lokr\icons'
} else {
  $IconDirectory = [Environment]::ExpandEnvironmentVariables($IconDirectory)
}
if (-not (Test-Path -LiteralPath $IconDirectory -PathType Container)) {
  [void](New-Item -ItemType Directory -Path $IconDirectory -Force)
}
$IconDirectory = (Resolve-Path -LiteralPath $IconDirectory).Path
$installedIconPath = Join-Path $IconDirectory "lokr-$iconHash.ico"
if (Test-Path -LiteralPath $installedIconPath -PathType Leaf) {
  $installedHash = (
    Get-FileHash -LiteralPath $installedIconPath -Algorithm SHA256
  ).Hash.ToLowerInvariant()
  if ($installedHash -ne $iconHash) {
    throw "The cached Lokr icon failed its integrity check: $installedIconPath"
  }
} else {
  $temporaryIconPath = Join-Path $IconDirectory ".lokr-$([Guid]::NewGuid().ToString('N')).ico"
  try {
    Copy-Item -LiteralPath $iconPath -Destination $temporaryIconPath
    [System.IO.File]::Move($temporaryIconPath, $installedIconPath)
  } finally {
    if (Test-Path -LiteralPath $temporaryIconPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryIconPath -Force
    }
  }
}

$DesktopDirectory = Resolve-DesktopDirectory
if (-not (Test-Path -LiteralPath $DesktopDirectory -PathType Container)) {
  [void](New-Item -ItemType Directory -Path $DesktopDirectory)
}
$DesktopDirectory = (Resolve-Path -LiteralPath $DesktopDirectory).Path

$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$shortcutPath = Join-Path $DesktopDirectory 'Lokr.lnk'
$temporaryPath = Join-Path $DesktopDirectory ".Lokr-$([Guid]::NewGuid().ToString('N')).lnk"
$backupPath = Join-Path $DesktopDirectory ".Lokr-backup-$([Guid]::NewGuid().ToString('N')).lnk"

function Quote-ShortcutArgument {
  param([string]$Value)

  if ($Value.Contains('"')) {
    throw 'A shortcut argument cannot contain a double quote.'
  }
  return '"' + $Value + '"'
}

$launcherArguments = @(
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-WindowStyle', 'Hidden',
  '-File', (Quote-ShortcutArgument -Value $launcherPath)
)
if ($PSBoundParameters.ContainsKey('Port')) {
  $launcherArguments += @('-Port', [string]$Port)
}
if ($PSBoundParameters.ContainsKey('ChromeUserDataDirectory')) {
  $launcherArguments += @(
    '-ChromeUserDataDirectory',
    (Quote-ShortcutArgument -Value $ChromeUserDataDirectory)
  )
}

Add-Type -TypeDefinition (
  Get-Content -LiteralPath (Join-Path $PSScriptRoot 'LokrShell.cs') -Raw
)
$appId = [Lokr.Launcher.LokrShell]::AppId($Port)

try {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($temporaryPath)
  $shortcut.TargetPath = $powerShellPath
  $shortcut.Arguments = $launcherArguments -join ' '
  $shortcut.WorkingDirectory = $ProjectRoot
  # Explorer caches icons by path. The content hash gives each revision a new
  # path so an updated transparent icon appears without clearing global caches.
  $shortcut.IconLocation = "$installedIconPath,0"
  $shortcut.Description = 'Open Lokr on this computer'
  $shortcut.WindowStyle = 7
  $shortcut.Save()

  if (-not (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
    throw 'Windows did not create the temporary Lokr shortcut.'
  }

  # WScript.Shell cannot set an app ID. The launcher labels Lokr's window with
  # the same one, so the shortcut and the window it opens are one Lokr program
  # to Windows. Pinning happens from the open window's button (task 4.5).
  [Lokr.Launcher.LokrShell]::SetShortcutAppId($temporaryPath, $appId)
  if ([Lokr.Launcher.LokrShell]::GetShortcutAppId($temporaryPath) -ne $appId) {
    throw 'Windows did not keep the Lokr app ID on the shortcut. The Desktop shortcut was not changed.'
  }

  if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    try {
      [System.IO.File]::Replace($temporaryPath, $shortcutPath, $backupPath, $true)
      Remove-Item -LiteralPath $backupPath -Force
    } catch {
      if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
        Copy-Item -LiteralPath $backupPath -Destination $shortcutPath -Force
        Remove-Item -LiteralPath $backupPath -Force
      }
      throw
    }
  } else {
    [System.IO.File]::Move($temporaryPath, $shortcutPath)
  }
} finally {
  if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

Write-Output "LOKR_SHORTCUT=$shortcutPath"
Write-Output "LOKR_ICON=$installedIconPath"
Write-Output "LOKR_APP_ID=$appId"
