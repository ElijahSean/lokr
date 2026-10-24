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

    if ($width -eq 256) {
      $pngBytes = New-Object byte[] $imageLength
      [Array]::Copy($bytes, $imageOffset, $pngBytes, 0, $imageLength)
      $pngStream = New-Object System.IO.MemoryStream(,$pngBytes)
      $bitmap = New-Object System.Drawing.Bitmap($pngStream)
      try {
        Assert-True ($bitmap.GetPixel(0, 0).A -eq 0) 'ICO corner must be transparent'
        Assert-True ($bitmap.GetPixel(128, 128).A -eq 255) 'ICO centre must be opaque'
      } finally {
        $bitmap.Dispose()
        $pngStream.Dispose()
      }
    }
  }

  Assert-True (
    (($actualSizes -join ',') -eq '16,32,48,256')
  ) "ICO sizes were $($actualSizes -join ',')"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = (Resolve-Path -LiteralPath $projectRoot).Path
$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$launcherPath = Join-Path $projectRoot 'scripts\Start-Lokr.ps1'
$installerPath = Join-Path $projectRoot 'scripts\Install-LokrShortcut.ps1'
$iconPath = Join-Path $projectRoot 'public\lokr.ico'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  'Lokr Launcher Tests ' + [Guid]::NewGuid().ToString('N')
)
$trackedServers = @()
$jobs = @()
[void](New-Item -ItemType Directory -Path $temporaryRoot)

try {
  Test-IconStructure -IconPath $iconPath

  $desktopPath = Join-Path $temporaryRoot 'Desktop With Spaces'
  $installOutput = & $powerShellPath `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $installerPath `
    -ProjectRoot $projectRoot `
    -DesktopDirectory $desktopPath `
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
  Assert-True ($shortcut.IconLocation -eq "$iconPath,0") 'shortcut icon'
  Assert-True ($shortcut.WindowStyle -eq 7) 'shortcut window style'

  & $powerShellPath `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $installerPath `
    -ProjectRoot $projectRoot `
    -DesktopDirectory $desktopPath `
    -SkipBuild | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'second install failed'
  $shortcuts = @(Get-ChildItem -LiteralPath $desktopPath -Filter 'Lokr.lnk')
  Assert-True ($shortcuts.Count -eq 1) 'installer created duplicate shortcuts'

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

  $chromeInvocationPath = Join-Path $temporaryRoot 'chrome-invocation.txt'
  $chromeStubPath = Join-Path $temporaryRoot 'Chrome Stub.cmd'
  Set-Content -LiteralPath $chromeStubPath -Encoding ASCII -Value @(
    '@echo off',
    ('echo %*>"' + $chromeInvocationPath + '"')
  )
  $browserResult = Invoke-Launcher `
    -PowerShellPath $powerShellPath `
    -LauncherPath $launcherPath `
    -ProjectRoot $projectRoot `
    -Port $startPort `
    -ChromePath $chromeStubPath `
    -OpenBrowser
  Assert-True ($browserResult.ExitCode -eq 0) "Chrome launch failed: $($browserResult.Output)"
  $chromeDeadline = [DateTime]::UtcNow.AddSeconds(5)
  while (-not (Test-Path -LiteralPath $chromeInvocationPath -PathType Leaf) -and
      [DateTime]::UtcNow -lt $chromeDeadline) {
    Start-Sleep -Milliseconds 50
  }
  Assert-True (Test-Path -LiteralPath $chromeInvocationPath -PathType Leaf) 'Chrome was not launched'
  $chromeArguments = (Get-Content -LiteralPath $chromeInvocationPath -Raw).Trim()
  Assert-True ($chromeArguments -eq "http://localhost:$startPort") (
    "Chrome received unexpected arguments: $chromeArguments"
  )

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
