[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw "Launcher check failed: $Message"
  }
}

function Get-FreePort {
  $listener = New-Object System.Net.Sockets.TcpListener(
    [System.Net.IPAddress]::Loopback,
    0
  )
  $listener.Start()
  try {
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Test-Port {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $attempt = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $attempt.AsyncWaitHandle.WaitOne(250)) {
      return $false
    }
    $client.EndConnect($attempt)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-ListenerProcessId {
  param([int]$Port)

  $pattern = '^\s*TCP\s+127\.0\.0\.1:' + $Port + '\s+.*\s+LISTENING\s+(\d+)\s*$'
  foreach ($line in (& "$env:SystemRoot\System32\netstat.exe" -ano -p TCP)) {
    if ($line -match $pattern) {
      return [int]$Matches[1]
    }
  }
  return 0
}

function Wait-ForPort {
  param(
    [int]$Port,
    [int]$Seconds = 10
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Port -Port $Port) {
      return $true
    }
    Start-Sleep -Milliseconds 100
  }
  return $false
}

function Invoke-Launcher {
  param(
    [string]$PowerShellPath,
    [string]$LauncherPath,
    [string]$ProjectRoot,
    [int]$Port,
    [int]$TimeoutSeconds = 15,
    [string]$ChromePath,
    [string]$ChromeUserDataDirectory,
    [switch]$OpenBrowser
  )

  $launcherArguments = @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $LauncherPath,
    '-ProjectRoot',
    $ProjectRoot,
    '-Port',
    $Port,
    '-StartupTimeoutSeconds',
    $TimeoutSeconds,
    '-NoDialogs'
  )
  if (-not $OpenBrowser) {
    $launcherArguments += '-NoBrowser'
  }
  if (-not [string]::IsNullOrWhiteSpace($ChromePath)) {
    $launcherArguments += @('-ChromePath', $ChromePath)
  }
  if (-not [string]::IsNullOrWhiteSpace($ChromeUserDataDirectory)) {
    $launcherArguments += @('-ChromeUserDataDirectory', $ChromeUserDataDirectory)
  }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $PowerShellPath @launcherArguments 2>&1 | Out-String
    $launcherExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }

  return [PSCustomObject]@{
    ExitCode = $launcherExitCode
    Output = $output
  }
}

function Stop-TestServer {
  param(
    [int]$ProcessId,
    [int]$Port
  )

  if ($ProcessId -eq 0) {
    return
  }

  $listenerProcessId = Get-ListenerProcessId -Port $Port
  if ($listenerProcessId -ne 0 -and $listenerProcessId -ne $ProcessId) {
    throw "Refusing to stop PID $ProcessId because PID $listenerProcessId owns port $Port."
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -ne $process) {
    Assert-True ($process.ProcessName -eq 'node') "PID $ProcessId is not Node"
    Stop-Process -Id $ProcessId -Force
  }
}

function Test-IconStructure {
  param([string]$IconPath)

  $bytes = [System.IO.File]::ReadAllBytes($IconPath)
  Assert-True ($bytes.Length -gt 70) 'the ICO is too small'
  Assert-True ([BitConverter]::ToUInt16($bytes, 0) -eq 0) 'ICO reserved field'
  Assert-True ([BitConverter]::ToUInt16($bytes, 2) -eq 1) 'ICO image type'

  $count = [BitConverter]::ToUInt16($bytes, 4)
  Assert-True ($count -eq 4) 'ICO must contain four image sizes'
  $actualSizes = @()

  for ($index = 0; $index -lt $count; $index++) {
    $entryOffset = 6 + (16 * $index)
    $widthByte = [int]$bytes[$entryOffset]
    $heightByte = [int]$bytes[$entryOffset + 1]
    $width = if ($widthByte -eq 0) { 256 } else { $widthByte }
    $height = if ($heightByte -eq 0) { 256 } else { $heightByte }
    Assert-True ($width -eq $height) "ICO entry $index is not square"
    $actualSizes += $width

    $imageLength = [BitConverter]::ToUInt32($bytes, $entryOffset + 8)
    $imageOffset = [BitConverter]::ToUInt32($bytes, $entryOffset + 12)
    Assert-True ($imageOffset + $imageLength -le $bytes.Length) "ICO entry $index bounds"
    $pngSignature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
    for ($byteIndex = 0; $byteIndex -lt $pngSignature.Length; $byteIndex++) {
      Assert-True (
        $bytes[$imageOffset + $byteIndex] -eq $pngSignature[$byteIndex]
      ) "ICO entry $index PNG signature"
    }

    $pngBytes = New-Object byte[] $imageLength
    [Array]::Copy($bytes, $imageOffset, $pngBytes, 0, $imageLength)
    $pngStream = New-Object System.IO.MemoryStream(,$pngBytes)
    $bitmap = New-Object System.Drawing.Bitmap($pngStream)
    try {
      $cornerAlphas = @(
        $bitmap.GetPixel(0, 0).A,
        $bitmap.GetPixel($width - 1, 0).A,
        $bitmap.GetPixel(0, $height - 1).A,
        $bitmap.GetPixel($width - 1, $height - 1).A
      )
      Assert-True (
        ($cornerAlphas | Measure-Object -Maximum).Maximum -le 16
      ) "ICO $width px corners must be transparent"
      Assert-True (
        $bitmap.GetPixel([int]($width / 2), [int]($height / 2)).A -eq 255
      ) "ICO $width px centre must be opaque"
    } finally {
      $bitmap.Dispose()
      $pngStream.Dispose()
    }
  }

  Assert-True (
    (($actualSizes -join ',') -eq '16,32,48,256')
  ) "ICO sizes were $($actualSizes -join ',')"
}

function Wait-ForFile {
  param(
    [string]$Path,
    [int]$Seconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while (-not (Test-Path -LiteralPath $Path -PathType Leaf) -and
      [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 50
  }
  return (Test-Path -LiteralPath $Path -PathType Leaf)
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = (Resolve-Path -LiteralPath $projectRoot).Path
Add-Type -TypeDefinition (
  Get-Content -LiteralPath (Join-Path $PSScriptRoot 'LokrShell.cs') -Raw
)
$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$launcherPath = Join-Path $projectRoot 'scripts\Start-Lokr.ps1'
$installerPath = Join-Path $projectRoot 'scripts\Install-LokrShortcut.ps1'
$iconPath = Join-Path $projectRoot 'public\lokr.ico'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  'Lokr Launcher Tests ' + [Guid]::NewGuid().ToString('N')
)
$trackedServers = @()
$stubWindowProcessIds = @()
$jobs = @()
[void](New-Item -ItemType Directory -Path $temporaryRoot)

try {
  Test-IconStructure -IconPath $iconPath

  $desktopPath = Join-Path $temporaryRoot 'Desktop With Spaces'
  $installedIconDirectory = Join-Path $temporaryRoot 'Icon Cache With Spaces'
  # A pre-4.4 shortcut has no app ID; installing must replace it with one.
  [void](New-Item -ItemType Directory -Path $desktopPath)
  $legacyShortcut = (New-Object -ComObject WScript.Shell).CreateShortcut(
    (Join-Path $desktopPath 'Lokr.lnk')
  )
  $legacyShortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
  $legacyShortcut.Save()
  Assert-True (
    [Lokr.Launcher.LokrShell]::GetShortcutAppId((Join-Path $desktopPath 'Lokr.lnk')) -eq ''
  ) 'legacy shortcut already had an app ID'
  $installOutput = & $powerShellPath `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $installerPath `
    -ProjectRoot $projectRoot `
    -DesktopDirectory $desktopPath `
    -IconDirectory $installedIconDirectory `
    -SkipBuild 2>&1 | Out-String
  Assert-True ($LASTEXITCODE -eq 0) "temporary install failed: $installOutput"

  $shortcutPath = Join-Path $desktopPath 'Lokr.lnk'
  Assert-True (Test-Path -LiteralPath $shortcutPath -PathType Leaf) 'shortcut was not created'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  Assert-True ($shortcut.TargetPath -eq $powerShellPath) 'shortcut target'
  Assert-True ($shortcut.Arguments.Contains('-WindowStyle Hidden')) 'hidden argument'
  Assert-True ($shortcut.Arguments.Contains('"' + $launcherPath + '"')) 'quoted launcher path'
  Assert-True ($shortcut.WorkingDirectory -eq $projectRoot) 'shortcut working directory'
  $installedIcons = @(Get-ChildItem -LiteralPath $installedIconDirectory -Filter 'lokr-*.ico')
  Assert-True ($installedIcons.Count -eq 1) 'one versioned icon was installed'
  $installedIconPath = $installedIcons[0].FullName
  Assert-True ($shortcut.IconLocation -eq "$installedIconPath,0") 'shortcut icon'
  Assert-True (
    (Get-FileHash -LiteralPath $installedIconPath -Algorithm SHA256).Hash -eq
      (Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash
  ) 'installed icon content'
  Assert-True ($shortcut.WindowStyle -eq 7) 'shortcut window style'
  Assert-True (-not $shortcut.Arguments.Contains('-Port')) 'default install forwards no port'
  Assert-True (
    [Lokr.Launcher.LokrShell]::GetShortcutAppId($shortcutPath) -eq 'Lokr.Desktop.Port3001'
  ) 'shortcut app ID'
  Assert-True ($installOutput.Contains('LOKR_APP_ID=Lokr.Desktop.Port3001')) 'reported app ID'

  & $powerShellPath `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $installerPath `
    -ProjectRoot $projectRoot `
    -DesktopDirectory $desktopPath `
    -IconDirectory $installedIconDirectory `
    -SkipBuild | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'second install failed'
  $shortcuts = @(Get-ChildItem -LiteralPath $desktopPath -Filter 'Lokr.lnk')
  Assert-True ($shortcuts.Count -eq 1) 'installer created duplicate shortcuts'
  Assert-True (
    @(Get-ChildItem -LiteralPath $installedIconDirectory -Filter 'lokr-*.ico').Count -eq 1
  ) 'second install created a duplicate icon cache entry'
  Assert-True (
    [Lokr.Launcher.LokrShell]::GetShortcutAppId($shortcutPath) -eq 'Lokr.Desktop.Port3001'
  ) 'reinstall changed the shortcut app ID'

  $portDesktopPath = Join-Path $temporaryRoot 'Port Desktop'
  $portProfilePath = Join-Path $temporaryRoot 'Port Profile With Spaces'
  & $powerShellPath `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $installerPath `
    -ProjectRoot $projectRoot `
    -DesktopDirectory $portDesktopPath `
    -IconDirectory $installedIconDirectory `
    -Port 3002 `
    -ChromeUserDataDirectory $portProfilePath `
    -SkipBuild | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'port-specific install failed'
  $portShortcutPath = Join-Path $portDesktopPath 'Lokr.lnk'
  $portShortcut = $shell.CreateShortcut($portShortcutPath)
  Assert-True ($portShortcut.Arguments.Contains('-Port 3002')) 'forwarded port'
  Assert-True (
    $portShortcut.Arguments.Contains('-ChromeUserDataDirectory "' + $portProfilePath + '"')
  ) 'forwarded profile'
  Assert-True (
    [Lokr.Launcher.LokrShell]::GetShortcutAppId($portShortcutPath) -eq 'Lokr.Desktop.Port3002'
  ) 'port-specific app ID'

  $missingRoot = Join-Path $temporaryRoot 'Missing Build'
  [void](New-Item -ItemType Directory -Path $missingRoot)
  $missingResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $missingRoot `
    -Port (Get-FreePort) `
    -TimeoutSeconds 1
  Assert-True ($missingResult.ExitCode -ne 0) 'missing build was accepted'
  Assert-True ($missingResult.Output.Contains('production build is missing')) 'missing-build message'

  $foreignPort = Get-FreePort
  $foreignScript = Join-Path $temporaryRoot 'foreign-server.cjs'
  Set-Content -LiteralPath $foreignScript -Encoding ASCII -Value (
    "require('http').createServer((req,res)=>{res.end('not lokr')}).listen(" +
    "$foreignPort,'127.0.0.1')"
  )
  $foreignStartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $foreignStartInfo.FileName = (
    Get-Command node.exe -CommandType Application -ErrorAction Stop |
      Select-Object -First 1
  ).Source
  $foreignStartInfo.Arguments = '"' + $foreignScript + '"'
  $foreignStartInfo.WorkingDirectory = $temporaryRoot
  $foreignStartInfo.UseShellExecute = $true
  $foreignStartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $foreignProcess = [System.Diagnostics.Process]::Start($foreignStartInfo)
  $trackedServers += [PSCustomObject]@{ ProcessId = $foreignProcess.Id; Port = $foreignPort }
  Assert-True (Wait-ForPort -Port $foreignPort) 'foreign listener did not start'
  $foreignResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $foreignPort `
    -TimeoutSeconds 2
  Assert-True ($foreignResult.ExitCode -ne 0) 'foreign listener was accepted as Lokr'
  Assert-True ($foreignResult.Output.Contains('not Lokr')) 'foreign-listener message'

  $timeoutRoot = Join-Path $temporaryRoot 'Timeout Project'
  $timeoutNextDirectory = Join-Path $timeoutRoot 'node_modules\next\dist\bin'
  [void](New-Item -ItemType Directory -Path $timeoutNextDirectory -Force)
  [void](New-Item -ItemType Directory -Path (Join-Path $timeoutRoot '.next') -Force)
  Set-Content -LiteralPath (Join-Path $timeoutRoot '.next\BUILD_ID') -Encoding ASCII -Value 'test'
  Set-Content -LiteralPath (Join-Path $timeoutNextDirectory 'next') -Encoding ASCII -Value (
    "setInterval(function () {}, 1000)"
  )
  $timeoutPort = Get-FreePort
  $timeoutResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $timeoutRoot `
    -Port $timeoutPort `
    -TimeoutSeconds 1
  Assert-True ($timeoutResult.ExitCode -ne 0) 'readiness timeout was accepted'
  Assert-True ($timeoutResult.Output.Contains('did not become ready')) 'readiness-timeout message'
  Assert-True (-not (Test-Port -Port $timeoutPort)) 'timed-out listener remained'

  $startPort = Get-FreePort
  $startResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort
  $observedStartPid = Get-ListenerProcessId -Port $startPort
  if ($observedStartPid -ne 0) {
    $trackedServers += [PSCustomObject]@{ ProcessId = $observedStartPid; Port = $startPort }
  }
  Assert-True ($startResult.ExitCode -eq 0) "first start failed: $($startResult.Output)"
  Assert-True ($startResult.Output.Contains('LOKR_STATUS=started')) 'first-start status'
  $startPidMatch = [regex]::Match($startResult.Output, 'LOKR_SERVER_PID=(\d+)')
  Assert-True ($startPidMatch.Success) 'first-start PID'
  $startPid = [int]$startPidMatch.Groups[1].Value
  Assert-True ($startPid -eq $observedStartPid) 'reported first-start PID'

  $reuseResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort
  Assert-True ($reuseResult.ExitCode -eq 0) "reuse failed: $($reuseResult.Output)"
  Assert-True ($reuseResult.Output.Contains('LOKR_STATUS=reused')) 'reuse status'
  Assert-True ($reuseResult.Output.Contains("LOKR_SERVER_PID=$startPid")) 'reuse PID changed'

  # The Chrome stub is a tiny compiled program that records its arguments and
  # shows one small off-screen window, standing in for Chrome's app window. Like
  # Chrome's browser process, it is the "Chrome" program and its command line
  # carries the profile argument.
  $chromeInvocationPath = Join-Path $temporaryRoot 'chrome-invocation.txt'
  $stubProcessIdPath = Join-Path $temporaryRoot 'stub-window.pid'
  $chromeStubPath = Join-Path $temporaryRoot 'Chrome Stub.exe'
  $chromeProfilePath = Join-Path $temporaryRoot 'Dedicated Chrome Profile'
  $stubSource = @'
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
public static class ChromeStub {
  [STAThread]
  public static void Main(string[] args) {
    File.WriteAllText(@"INVOCATION", String.Join(" ", args));
    File.WriteAllText(@"PIDFILE", System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
    Form form = new Form();
    form.Text = "Lokr launcher test window";
    form.ShowInTaskbar = false;
    form.StartPosition = FormStartPosition.Manual;
    form.Location = new Point(-3000, -3000);
    form.Size = new Size(200, 120);
    Timer timer = new Timer();
    timer.Interval = 120000;
    timer.Tick += delegate { form.Close(); };
    timer.Start();
    Application.Run(form);
  }
}
'@
  $stubSource = $stubSource.Replace('INVOCATION', $chromeInvocationPath).Replace('PIDFILE', $stubProcessIdPath)
  Add-Type -TypeDefinition $stubSource `
    -OutputAssembly $chromeStubPath `
    -OutputType WindowsApplication `
    -ReferencedAssemblies System.Windows.Forms, System.Drawing
  $expectedChromeArguments = (
    "--user-data-dir=$chromeProfilePath --no-first-run --no-default-browser-check " +
    "--app=http://localhost:$startPort"
  )

  $browserResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort `
    -ChromePath $chromeStubPath `
    -ChromeUserDataDirectory $chromeProfilePath `
    -OpenBrowser
  if (Test-Path -LiteralPath $stubProcessIdPath -PathType Leaf) {
    $stubWindowProcessIds += [int](Get-Content -LiteralPath $stubProcessIdPath -Raw)
  }
  Assert-True ($browserResult.ExitCode -eq 0) "Chrome launch failed: $($browserResult.Output)"
  Assert-True (Wait-ForFile -Path $chromeInvocationPath) 'Chrome was not launched'
  Assert-True (Test-Path -LiteralPath $chromeProfilePath -PathType Container) 'dedicated profile was not created'
  $chromeArguments = (Get-Content -LiteralPath $chromeInvocationPath -Raw).Trim()
  # Exact list: app mode, the dedicated profile, both prompt flags, no bare URL
  # and no normal-profile selector.
  Assert-True ($chromeArguments -eq $expectedChromeArguments) "Chrome arguments were: $chromeArguments"
  Assert-True (
    $browserResult.Output.Contains("LOKR_CHROME_PROFILE=$chromeProfilePath")
  ) 'reported dedicated profile path'
  Assert-True ($browserResult.Output.Contains('LOKR_WINDOW=opened')) "window not labelled: $($browserResult.Output)"
  # The temporary paths make the re-open command longer than Windows accepts:
  # the window keeps its app ID but is reported, not silently left, unpinnable.
  # The default install's command (about 170 characters) was seen pinned in 4.5.
  Assert-True ($browserResult.Output.Contains('LOKR_RELAUNCH=skipped')) "long re-open command not reported: $($browserResult.Output)"
  Assert-True (
    $browserResult.Output.Contains('this Lokr window cannot be pinned')
  ) 'long re-open command warning'
  $stubWindowProcessId = $stubWindowProcessIds[-1]
  $stubWindow = [Lokr.Launcher.LokrShell]::FindMarked([int[]]@($stubWindowProcessId), $startPort)
  Assert-True ($stubWindow -ne 0) 'the opened window carries no Lokr marker'
  Assert-True (
    [Lokr.Launcher.LokrShell]::FindMarked([int[]]@($stubWindowProcessId), $startPort + 1) -eq 0
  ) 'the marker is not port-specific'

  # A second launch with the window open brings it forward instead of starting Chrome.
  Remove-Item -LiteralPath $chromeInvocationPath -Force
  $secondBrowserResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort `
    -ChromePath $chromeStubPath `
    -ChromeUserDataDirectory $chromeProfilePath `
    -OpenBrowser
  Assert-True ($secondBrowserResult.ExitCode -eq 0) 'second dedicated-profile launch failed'
  Assert-True ($secondBrowserResult.Output.Contains('LOKR_STATUS=reused')) 'profile launch did not reuse server'
  Assert-True (
    $secondBrowserResult.Output.Contains("LOKR_CHROME_PROFILE=$chromeProfilePath")
  ) 'second launch changed dedicated profile path'
  Assert-True (
    [regex]::IsMatch($secondBrowserResult.Output, 'LOKR_WINDOW=(focused|flashed)')
  ) "second launch did not reuse the window: $($secondBrowserResult.Output)"
  Assert-True (-not $secondBrowserResult.Output.Contains('LOKR_RELAUNCH=')) 'an existing window was labelled again'
  Assert-True (-not (Wait-ForFile -Path $chromeInvocationPath -Seconds 2)) 'second launch started Chrome again'

  # A minimised Lokr window is restored, still without a second Chrome start.
  [Lokr.Launcher.LokrShell]::Minimise($stubWindow)
  Assert-True ([Lokr.Launcher.LokrShell]::IsMinimised($stubWindow)) 'test window did not minimise'
  $restoreResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort `
    -ChromePath $chromeStubPath `
    -ChromeUserDataDirectory $chromeProfilePath `
    -OpenBrowser
  Assert-True ($restoreResult.ExitCode -eq 0) 'restore launch failed'
  Assert-True (-not [Lokr.Launcher.LokrShell]::IsMinimised($stubWindow)) 'minimised window was not restored'
  Assert-True (-not (Wait-ForFile -Path $chromeInvocationPath -Seconds 2)) 'restore launch started Chrome again'

  # Once the window is closed, a launch opens exactly one new one.
  Stop-Process -Id $stubWindowProcessId -Force
  Wait-Process -Id $stubWindowProcessId -Timeout 10 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stubProcessIdPath -Force
  $reopenResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort `
    -ChromePath $chromeStubPath `
    -ChromeUserDataDirectory $chromeProfilePath `
    -OpenBrowser
  if (Test-Path -LiteralPath $stubProcessIdPath -PathType Leaf) {
    $stubWindowProcessIds += [int](Get-Content -LiteralPath $stubProcessIdPath -Raw)
  }
  Assert-True ($reopenResult.ExitCode -eq 0) 'reopen launch failed'
  Assert-True ($reopenResult.Output.Contains('LOKR_WINDOW=opened')) "closed window was not reopened: $($reopenResult.Output)"
  Assert-True (Wait-ForFile -Path $chromeInvocationPath) 'reopen did not start Chrome'

  # A Chrome that never shows a window leaves Lokr usable but unlabelled, not failed.
  $echoStubPath = Join-Path $temporaryRoot 'Chrome Echo Stub.cmd'
  Set-Content -LiteralPath $echoStubPath -Encoding ASCII -Value @('@echo off', 'exit /b 0')
  $unlabelledResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort `
    -TimeoutSeconds 2 `
    -ChromePath $echoStubPath `
    -ChromeUserDataDirectory (Join-Path $temporaryRoot 'Windowless Profile') `
    -OpenBrowser
  Assert-True ($unlabelledResult.ExitCode -eq 0) "windowless Chrome failed the launch: $($unlabelledResult.Output)"
  Assert-True ($unlabelledResult.Output.Contains('LOKR_WINDOW=unlabelled')) 'windowless status'
  Assert-True (-not $unlabelledResult.Output.Contains('LOKR_RELAUNCH=')) 'relaunch reported with no window'

  $profileCollisionPath = Join-Path $temporaryRoot 'Profile Is A File'
  Set-Content -LiteralPath $profileCollisionPath -Encoding ASCII -Value 'not a directory'
  $profileCollisionPort = Get-FreePort
  $profileCollisionResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $profileCollisionPort `
    -ChromePath $chromeStubPath `
    -ChromeUserDataDirectory $profileCollisionPath `
    -OpenBrowser
  Assert-True ($profileCollisionResult.ExitCode -ne 0) 'profile file collision was accepted'
  Assert-True (
    $profileCollisionResult.Output.Contains('profile path is not a directory')
  ) 'profile file-collision message'
  Assert-True (-not (Test-Port -Port $profileCollisionPort)) 'profile collision started a server'

  $missingChromePort = Get-FreePort
  $missingChromeResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $missingChromePort `
    -ChromePath (Join-Path $temporaryRoot 'Missing Chrome.exe') `
    -OpenBrowser
  Assert-True ($missingChromeResult.ExitCode -ne 0) 'missing Chrome was accepted'
  Assert-True ($missingChromeResult.Output.Contains('Chrome was not found')) 'missing-Chrome message'
  Assert-True (-not (Test-Port -Port $missingChromePort)) 'missing Chrome started a server'

  $racePort = Get-FreePort
  for ($index = 0; $index -lt 2; $index++) {
    $jobs += Start-Job -ScriptBlock {
      param($PowerShellPath, $LauncherPath, $ProjectRoot, $Port)
      $output = & $PowerShellPath `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $LauncherPath `
        -ProjectRoot $ProjectRoot `
        -Port $Port `
        -StartupTimeoutSeconds 15 `
        -NoBrowser `
        -NoDialogs 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) {
        throw $output
      }
      return $output
    } -ArgumentList $powerShellPath, $launcherPath, $projectRoot, $racePort
  }
  $null = Wait-Job -Job $jobs -Timeout 30
  $racePid = Get-ListenerProcessId -Port $racePort
  if ($racePid -ne 0) {
    $trackedServers += [PSCustomObject]@{ ProcessId = $racePid; Port = $racePort }
  }
  foreach ($job in $jobs) {
    Assert-True ($job.State -eq 'Completed') "concurrent launch state $($job.State)"
  }
  $raceOutput = ($jobs | Receive-Job) -join [Environment]::NewLine
  Assert-True ($raceOutput.Contains('LOKR_STATUS=started')) 'race had no starter'
  Assert-True ($raceOutput.Contains('LOKR_STATUS=reused')) 'race had no reuse'
  Assert-True ($racePid -ne 0) 'race left no listener'

  Write-Output 'LAUNCHER_CHECKS=passed'
} finally {
  foreach ($job in $jobs) {
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
  foreach ($stubProcessId in $stubWindowProcessIds) {
    $stubProcess = Get-Process -Id $stubProcessId -ErrorAction SilentlyContinue
    if ($null -ne $stubProcess -and $stubProcess.ProcessName -eq 'Chrome Stub') {
      Stop-Process -Id $stubProcessId -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $stubProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
  }
  foreach ($server in $trackedServers) {
    Stop-TestServer -ProcessId $server.ProcessId -Port $server.Port
  }

  $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
  $expectedPrefix = [System.IO.Path]::GetFullPath(
    (Join-Path ([System.IO.Path]::GetTempPath()) 'Lokr Launcher Tests ')
  )
  if (-not $resolvedTemporaryRoot.StartsWith(
    $expectedPrefix,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Refusing to remove unexpected temporary path: $resolvedTemporaryRoot"
  }
  Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
}
