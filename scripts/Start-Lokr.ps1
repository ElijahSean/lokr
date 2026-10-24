[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3001,

  [string]$ProjectRoot,

  [ValidateRange(1, 300)]
  [int]$StartupTimeoutSeconds = 30,

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
  $mutex = New-Object System.Threading.Mutex($false, "Local\LokrLauncher-$Port")
  try {
    $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds($StartupTimeoutSeconds + 5))
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) {
    throw "Another Lokr launch did not finish within $($StartupTimeoutSeconds + 5) seconds."
  }

  $buildIdPath = Join-Path $ProjectRoot '.next\BUILD_ID'
  if (-not (Test-Path -LiteralPath $buildIdPath -PathType Leaf)) {
    throw 'The production build is missing. Run pnpm shortcut:install from the Lokr folder.'
  }

  $nextCli = Join-Path $ProjectRoot 'node_modules\next\dist\bin\next'
  if (-not (Test-Path -LiteralPath $nextCli -PathType Leaf)) {
    throw 'The local Next.js executable is missing. Run pnpm install, then pnpm shortcut:install.'
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

  if (-not $NoBrowser) {
    Start-Process -FilePath $url
  }

  Write-Output "LOKR_STATUS=$status"
  Write-Output "LOKR_SERVER_PID=$serverProcessId"
  Write-Output "LOKR_URL=$url"
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
