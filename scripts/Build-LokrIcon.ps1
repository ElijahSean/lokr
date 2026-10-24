[CmdletBinding()]
param(
  [string]$OutputPath,
  [string]$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceSvg = Join-Path $projectRoot 'public\logo.svg'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $projectRoot 'public\lokr.ico'
}
if (-not (Test-Path -LiteralPath $sourceSvg -PathType Leaf)) {
  throw "The source logo is missing: $sourceSvg"
}
if (-not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) {
  throw "Chrome is required to rasterize the existing SVG logo: $ChromePath"
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  'LokrIcon-' + [Guid]::NewGuid().ToString('N')
)
[void](New-Item -ItemType Directory -Path $temporaryRoot)

try {
  $sourceUri = ([Uri]$sourceSvg).AbsoluteUri
  $sizes = @(16, 32, 48, 256)
  $images = @()

  foreach ($size in $sizes) {
    # Headless Chrome keeps a minimum layout width even for smaller screenshots.
    # Pinning the vector to the top-left prevents that wider viewport from
    # centring and cropping the square Windows icon.
    $htmlPath = Join-Path $temporaryRoot "$size.html"
    $html = @"
<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{width:${size}px;height:${size}px;margin:0;padding:0;overflow:hidden}
img{display:block;width:${size}px;height:${size}px}
</style></head><body><img src="$sourceUri" alt=""></body></html>
"@
    Set-Content -LiteralPath $htmlPath -Value $html -Encoding UTF8
    $htmlUri = ([Uri]$htmlPath).AbsoluteUri
    $pngPath = Join-Path $temporaryRoot "$size.png"
    $profilePath = Join-Path $temporaryRoot "profile-$size"
    & $ChromePath `
      '--headless=new' `
      '--disable-gpu' `
      '--hide-scrollbars' `
      '--no-first-run' `
      '--no-default-browser-check' `
      "--user-data-dir=$profilePath" `
      "--window-size=$size,$size" `
      "--screenshot=$pngPath" `
      $htmlUri | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pngPath -PathType Leaf)) {
      throw "Chrome could not render the $size x $size Lokr icon."
    }

    $bytes = [System.IO.File]::ReadAllBytes($pngPath)
    if ($bytes.Length -lt 24) {
      throw "Chrome produced an invalid $size x $size PNG."
    }
    $width = [System.Net.IPAddress]::NetworkToHostOrder(
      [BitConverter]::ToInt32($bytes, 16)
    )
    $height = [System.Net.IPAddress]::NetworkToHostOrder(
      [BitConverter]::ToInt32($bytes, 20)
    )
    if ($width -ne $size -or $height -ne $size) {
      throw "Chrome rendered ${width}x${height}; expected ${size}x${size}."
    }

    $images += ,$bytes
  }

  $outputDirectory = Split-Path -Parent $OutputPath
  if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $outputDirectory)
  }

  $stream = New-Object System.IO.FileStream(
    $OutputPath,
    [System.IO.FileMode]::Create,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($index = 0; $index -lt $sizes.Count; $index++) {
      $sizeByte = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
      $writer.Write([Byte]$sizeByte)
      $writer.Write([Byte]$sizeByte)
      $writer.Write([Byte]0)
      $writer.Write([Byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$images[$index].Length)
      $writer.Write([UInt32]$offset)
      $offset += $images[$index].Length
    }

    foreach ($image in $images) {
      $writer.Write($image)
    }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }

  Write-Output "LOKR_ICON=$OutputPath"
} finally {
  $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
  $expectedPrefix = [System.IO.Path]::GetFullPath(
    (Join-Path ([System.IO.Path]::GetTempPath()) 'LokrIcon-')
  )
  if (-not $resolvedTemporaryRoot.StartsWith(
    $expectedPrefix,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Refusing to remove unexpected temporary path: $resolvedTemporaryRoot"
  }
  Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
}
