[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3001,

  [string]$ProjectRoot,

  [ValidateRange(1, 300)]
  [int]$StartupTimeoutSeconds = 30,

  [string]$ChromePath,
  [string]$ChromeUserDataDirectory,

  [switch]$NoBrowser,
  [switch]$NoDialogs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Show-LokrError {
  param([string]$Message)

  if ($NoDialogs) {
    return
  }

  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
      $Message,
      'Lokr',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    )
  } catch {
    # A launcher error must still reach stderr if Windows cannot show a dialog.
  }
}

function Test-LocalPort {
  param([int]$LocalPort)

  $netstatPath = Join-Path $env:SystemRoot 'System32\netstat.exe'
  $pattern = '^\s*TCP\s+\S+:' + $LocalPort + '\s+\S+\s+LISTENING\s+\d+\s*$'
  foreach ($line in (& $netstatPath -ano -p TCP)) {
    if ($line -match $pattern) {
      return $true
    }
  }
  return $false
}

function Test-LokrResponse {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 2
    return (
      $response.StatusCode -eq 200 -and
      $response.Content.Contains('<title>Lokr ') -and
      $response.Content.Contains(' Your secrets, your machine.</title>')
    )
  } catch {
    return $false
  }
}

function Get-ListenerProcessId {
  param([int]$LocalPort)

  $netstatPath = Join-Path $env:SystemRoot 'System32\netstat.exe'
  $pattern = '^\s*TCP\s+\S+:' + $LocalPort + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
  foreach ($line in (& $netstatPath -ano -p TCP)) {
    if ($line -match $pattern) {
      return [int]$Matches[1]
    }
  }

  return 0
}

function Get-ListenerProcessIds {
  param([int]$LocalPort)

  $netstatPath = Join-Path $env:SystemRoot 'System32\netstat.exe'
  $pattern = '^\s*TCP\s+\S+:' + $LocalPort + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
  $processIds = @()
  foreach ($line in (& $netstatPath -ano -p TCP)) {
    if ($line -match $pattern) {
      $processIds += [int]$Matches[1]
    }
  }
  return @($processIds | Select-Object -Unique)
}

function Get-IPv4ListenerProcessId {
  param([int]$LocalPort)

  $netstatPath = Join-Path $env:SystemRoot 'System32\netstat.exe'
  $pattern = '^\s*TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0):' + $LocalPort +
    '\s+\S+\s+LISTENING\s+(\d+)\s*$'
  foreach ($line in (& $netstatPath -ano -p TCP)) {
    if ($line -match $pattern) {
      return [int]$Matches[1]
    }
  }
  return 0
}

function Quote-ProcessArgument {
  param([string]$Value)

  if ($Value.Contains('"')) {
    throw 'A Windows process argument cannot contain a double quote.'
  }

  return '"' + $Value + '"'
}

function Resolve-ChromeExecutable {
  param([string]$RequestedPath)

  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
      throw "Google Chrome was not found at the requested path: $RequestedPath"
    }
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $candidates = @()
  $chromeCommand = Get-Command chrome.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -ne $chromeCommand) {
    $candidates += $chromeCommand.Source
  }

  foreach ($registryPath in @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
  )) {
    if (Test-Path -LiteralPath $registryPath) {
      $registeredPath = (Get-Item -LiteralPath $registryPath).GetValue('')
      if (-not [string]::IsNullOrWhiteSpace($registeredPath)) {
        $candidates += $registeredPath
      }
    }
  }

  $candidates += @(
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
  )
  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
    $candidates += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and
        (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw 'Google Chrome was not found. Install Chrome, then launch Lokr again.'
}

function Resolve-ChromeUserDataDirectory {
  param([string]$RequestedPath)

  if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
    $localAppData = [Environment]::GetFolderPath(
      [Environment+SpecialFolder]::LocalApplicationData
    )
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
      throw 'Windows did not provide a local application-data folder for the dedicated Chrome profile.'
    }
    $RequestedPath = Join-Path $localAppData 'Lokr\ChromeProfile'
  } else {
    $RequestedPath = [Environment]::ExpandEnvironmentVariables($RequestedPath)
  }

  $fullPath = [System.IO.Path]::GetFullPath($RequestedPath)
  if (Test-Path -LiteralPath $fullPath) {
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
      throw "The dedicated Chrome profile path is not a directory: $fullPath"
    }
  } else {
    [void](New-Item -ItemType Directory -Path $fullPath -Force)
  }

  return (Resolve-Path -LiteralPath $fullPath).Path
}

# Chrome processes started with this exact dedicated profile. Matching the
# program and command line finds Lokr's windows without reading anything inside
# the profile (4.3).
function Get-ChromeProfileProcessIds {
  param(
    [string]$ChromeExecutable,
    [string]$ProfileDirectory
  )

  $pattern = '--user-data-dir="?' + [regex]::Escape($ProfileDirectory) + '"?(\s|"|$)'
  Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
    Where-Object {
      $null -ne $_.CommandLine -and
      $null -ne $_.ExecutablePath -and
      [string]::Equals($_.ExecutablePath, $ChromeExecutable, 'OrdinalIgnoreCase') -and
      [regex]::IsMatch($_.CommandLine, $pattern, 'IgnoreCase')
    } |
    ForEach-Object { [int]$_.ProcessId }
}

# Prefer the installer's content-hash icon copy: Explorer caches icons by path,
# so a changed icon needs a new path (4.1). Falls back to the repository icon.
function Resolve-WindowIcon {
  param([string]$Root)

  $projectIcon = Join-Path $Root 'public\lokr.ico'
  $localAppData = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::LocalApplicationData
  )
  if (-not [string]::IsNullOrWhiteSpace($localAppData) -and
      (Test-Path -LiteralPath $projectIcon -PathType Leaf)) {
    $iconHash = (Get-FileHash -LiteralPath $projectIcon -Algorithm SHA256).Hash.ToLowerInvariant()
    $installedIcon = Join-Path $localAppData "Lokr\icons\lokr-$iconHash.ico"
    if (Test-Path -LiteralPath $installedIcon -PathType Leaf) {
      return $installedIcon
    }
  }
  return $projectIcon
}

$mutex = $null
$ownsMutex = $false
$exitCode = 0
$startedProcessId = 0
$startedServerReady = $false

try {
  if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
  }
  $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

  # Serialising by port closes the double-click race before either process probes
  # or starts Next. The mutex holds no vault data and exists only for this launch.
  # A launch may wait once for the server and once for the window (4.4).
  $mutexWaitSeconds = (2 * $StartupTimeoutSeconds) + 5
  $mutex = New-Object System.Threading.Mutex($false, "Local\LokrLauncher-$Port")
  try {
    $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds($mutexWaitSeconds))
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) {
    throw "Another Lokr launch did not finish within $mutexWaitSeconds seconds."
  }

  $buildIdPath = Join-Path $ProjectRoot '.next\BUILD_ID'
  if (-not (Test-Path -LiteralPath $buildIdPath -PathType Leaf)) {
    throw 'The production build is missing. Run pnpm shortcut:install from the Lokr folder.'
  }

  $nextCli = Join-Path $ProjectRoot 'node_modules\next\dist\bin\next'
  if (-not (Test-Path -LiteralPath $nextCli -PathType Leaf)) {
    throw 'The local Next.js executable is missing. Run pnpm install, then pnpm shortcut:install.'
  }

  $chromeExecutable = $null
  $chromeProfileDirectory = $null
  if (-not $NoBrowser) {
    $chromeExecutable = Resolve-ChromeExecutable -RequestedPath $ChromePath
    $chromeProfileDirectory = Resolve-ChromeUserDataDirectory `
      -RequestedPath $ChromeUserDataDirectory
  }

  $url = "http://localhost:$Port"
  # Next binds only to IPv4; use the numeric loopback address for readiness so
  # a Windows localhost-to-IPv6 preference cannot consume the startup timeout.
  $probeUrl = "http://127.0.0.1:$Port"
  $status = 'reused'
  $serverProcessId = 0

  if (Test-LocalPort -LocalPort $Port) {
    $listenerProcessIds = @(Get-ListenerProcessIds -LocalPort $Port)
    $ipv4IsLokr = Test-LokrResponse -Url $probeUrl
    $browserHostIsLokr = $false
    if (-not $ipv4IsLokr -or $listenerProcessIds.Count -gt 1) {
      $browserHostIsLokr = Test-LokrResponse -Url $url
    }

    if ($ipv4IsLokr) {
      $serverProcessId = Get-IPv4ListenerProcessId -LocalPort $Port
      $otherOwner = @(
        $listenerProcessIds | Where-Object { $_ -ne $serverProcessId }
      )
      if ($serverProcessId -eq 0 -or $otherOwner.Count -gt 0) {
        throw "Port $Port has another listener in addition to Lokr."
      }
    } elseif ($browserHostIsLokr -and $listenerProcessIds.Count -eq 1) {
      $serverProcessId = $listenerProcessIds[0]
    } else {
      throw "Port $Port is already in use by an application that is not Lokr."
    }
  } else {
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction Stop |
      Select-Object -First 1
    $arguments = @(
      (Quote-ProcessArgument -Value $nextCli),
      'start',
      (Quote-ProcessArgument -Value $ProjectRoot),
      '-H',
      '127.0.0.1',
      '-p',
      [string]$Port
    ) -join ' '

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeCommand.Source
    $startInfo.Arguments = $arguments
    $startInfo.WorkingDirectory = $ProjectRoot
    # Shell execution detaches the long-lived server from the launcher's stdout
    # handles; WindowStyle keeps Node's console hidden after PowerShell exits.
    $startInfo.UseShellExecute = $true
    $startInfo.CreateNoWindow = $false
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

    $serverProcess = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $serverProcess) {
      throw 'Windows could not start the Lokr server process.'
    }

    $serverProcessId = $serverProcess.Id
    $startedProcessId = $serverProcessId
    $status = 'started'
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $ready = $false

    while ([DateTime]::UtcNow -lt $deadline) {
      $serverProcess.Refresh()
      if ($serverProcess.HasExited) {
        throw "Lokr stopped before it was ready (exit code $($serverProcess.ExitCode))."
      }

      if (Test-LokrResponse -Url $probeUrl) {
        $ready = $true
        $startedServerReady = $true
        break
      }

      if ((Test-LocalPort -LocalPort $Port) -and -not (Test-LokrResponse -Url $probeUrl)) {
        $listenerProcessId = Get-ListenerProcessId -LocalPort $Port
        if ($listenerProcessId -ne 0 -and $listenerProcessId -ne $serverProcessId) {
          Stop-Process -Id $serverProcessId -Force -ErrorAction SilentlyContinue
          throw "Port $Port was claimed by another application while Lokr was starting."
        }
      }

      Start-Sleep -Milliseconds 200
    }

    if (-not $ready) {
      Stop-Process -Id $serverProcessId -Force -ErrorAction SilentlyContinue
      throw "Lokr did not become ready within $StartupTimeoutSeconds seconds."
    }
  }

  $windowStatus = $null
  $relaunchStatus = $null
  if (-not $NoBrowser) {
    Add-Type -TypeDefinition (
      Get-Content -LiteralPath (Join-Path $PSScriptRoot 'LokrShell.cs') -Raw
    )

    # One Lokr window: a second launch brings the labelled window forward
    # (restored if minimised) instead of opening another one that starts locked.
    # @() because PowerShell turns an empty function result into $null.
    $profileProcessIds = [int[]]@(
      Get-ChromeProfileProcessIds -ChromeExecutable $chromeExecutable `
        -ProfileDirectory $chromeProfileDirectory
    )
    $openWindow = [Lokr.Launcher.LokrShell]::FindMarked($profileProcessIds, $Port)
    if ($openWindow -ne 0) {
      if ([Lokr.Launcher.LokrShell]::BringForward($openWindow)) {
        $windowStatus = 'focused'
      } else {
        $windowStatus = 'flashed'
      }
    } else {
      $windowsBefore = @([Lokr.Launcher.LokrShell]::VisibleWindows($profileProcessIds))

      # App mode: no tab strip or address bar. Same origin and profile as 4.3,
      # so the existing vault opens unchanged.
      Start-Process -FilePath $chromeExecutable -ArgumentList @(
        (Quote-ProcessArgument -Value ("--user-data-dir=$chromeProfileDirectory")),
        '--no-first-run',
        '--no-default-browser-check',
        "--app=$url"
      )

      $iconResource = (Resolve-WindowIcon -Root $ProjectRoot) + ',0'
      # The command a pinned Lokr window runs: this launcher, hidden, with the
      # same port and profile, so it starts the server after a restart. Pinning
      # the window's own button is how Lokr is pinned (task 4.5): Windows saves
      # the pin from these values when the window closes, as an implicit
      # shortcut, not in the User Pinned\TaskBar folder.
      # PowerShell's documented short flags (-NoProfile -NonInteractive
      # -ExecutionPolicy -WindowStyle) keep this under Windows' length cap.
      $relaunchArguments = @(
        '-NoP', '-NonI', '-EP', 'Bypass', '-W', 'Hidden',
        '-File', (Quote-ProcessArgument -Value $PSCommandPath)
      )
      if ($PSBoundParameters.ContainsKey('Port')) {
        $relaunchArguments += @('-Port', [string]$Port)
      }
      if ($PSBoundParameters.ContainsKey('ChromeUserDataDirectory')) {
        $relaunchArguments += @(
          '-ChromeUserDataDirectory',
          (Quote-ProcessArgument -Value $chromeProfileDirectory)
        )
      }
      if ($PSBoundParameters.ContainsKey('ChromePath')) {
        $relaunchArguments += @('-ChromePath', (Quote-ProcessArgument -Value $chromeExecutable))
      }
      $relaunchCommand = (Quote-ProcessArgument -Value (Join-Path $PSHOME 'powershell.exe')) +
        ' ' + ($relaunchArguments -join ' ')
      # Windows refuses relaunch values of 256 characters or more. The default
      # install is about 170; a long custom path keeps the app ID (one taskbar
      # button) but leaves the window unpinnable. A pinned Desktop shortcut is
      # no substitute: Windows records no pin from it (task 4.5).
      $relaunchStatus = 'set'
      if ($relaunchCommand.Length -ge 256 -or $iconResource.Length -ge 256) {
        [Console]::Error.WriteLine(
          'Lokr launcher: the re-open command is too long for Windows, so this Lokr window cannot be pinned; use a shorter project or profile path.'
        )
        $relaunchCommand = ''
        $relaunchStatus = 'skipped'
      }

      # Chrome sets no app ID on an --app window, so the new window is labelled
      # here. A normal tabbed window of the profile (title ends in the browser
      # name) is never taken for Lokr's.
      $windowStatus = 'unlabelled'
      $windowDeadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
      while ([DateTime]::UtcNow -lt $windowDeadline) {
        $profileProcessIds = [int[]]@(
          Get-ChromeProfileProcessIds -ChromeExecutable $chromeExecutable `
            -ProfileDirectory $chromeProfileDirectory
        )
        $newWindows = @(
          [Lokr.Launcher.LokrShell]::VisibleWindows($profileProcessIds) |
            Where-Object {
              $windowsBefore -notcontains $_ -and
              -not [Lokr.Launcher.LokrShell]::WindowTitle($_).EndsWith(' - Google Chrome')
            }
        )
        if ($newWindows.Count -gt 0) {
          # Lokr is already open and usable at this point; a refused label only
          # costs the taskbar identity, so it is reported rather than fatal.
          try {
            [Lokr.Launcher.LokrShell]::Label(
              $newWindows[0], $Port, $relaunchCommand, $iconResource, 'Lokr'
            )
            $windowStatus = 'opened'
          } catch {
            [Console]::Error.WriteLine("Lokr launcher: $($_.Exception.Message)")
          }
          break
        }
        Start-Sleep -Milliseconds 250
      }
    }
  }

  Write-Output "LOKR_STATUS=$status"
  Write-Output "LOKR_SERVER_PID=$serverProcessId"
  Write-Output "LOKR_URL=$url"
  if (-not $NoBrowser) {
    Write-Output "LOKR_CHROME_PROFILE=$chromeProfileDirectory"
    Write-Output "LOKR_WINDOW=$windowStatus"
    # Only a newly labelled window has relaunch values; an existing one keeps its own.
    if ($windowStatus -eq 'opened') {
      Write-Output "LOKR_RELAUNCH=$relaunchStatus"
    }
  }
} catch {
  $exitCode = 1
  $message = $_.Exception.Message
  if ($startedProcessId -ne 0 -and -not $startedServerReady) {
    $startedProcess = Get-Process -Id $startedProcessId -ErrorAction SilentlyContinue
    if ($null -ne $startedProcess -and $startedProcess.ProcessName -eq 'node') {
      Stop-Process -Id $startedProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Show-LokrError -Message $message
  [Console]::Error.WriteLine("Lokr launcher: $message")
} finally {
  if ($ownsMutex -and $null -ne $mutex) {
    $mutex.ReleaseMutex()
  }
  if ($null -ne $mutex) {
    $mutex.Dispose()
  }
}

exit $exitCode
