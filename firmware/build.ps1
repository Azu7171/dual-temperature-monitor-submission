# Build / upload / monitor helper for the third-box firmware.
#
#   .\build.ps1                 compile both display backends
#   .\build.ps1 -Upload         compile and upload (auto-detects the port)
#   .\build.ps1 -Upload -Oled   same, but with the SH1106 backend
#   .\build.ps1 -Monitor        open the serial monitor
#
param(
  [switch]$Upload,
  [switch]$Monitor,
  [switch]$Oled,
  [string]$Port
)

$ErrorActionPreference = 'Stop'
$cli    = "$env:LOCALAPPDATA\Programs\arduino-cli\arduino-cli.exe"
$sketch = Join-Path $PSScriptRoot 'dual_temp_monitor'
$fqbn   = 'esp32:esp32:esp32'

function Find-Port {
  if ($Port) { return $Port }
  $json = & $cli board list --format json | ConvertFrom-Json
  $p = $json.detected_ports | Where-Object { $_.port.protocol -eq 'serial' } | Select-Object -First 1
  if (-not $p) {
    throw "No board found. Check the cable is a data cable, not charge-only, and that the CP210x or CH340 driver is installed."
  }
  return $p.port.address
}

if ($Monitor) {
  $p = Find-Port
  Write-Host "monitoring $p at 921600" -ForegroundColor Cyan
  & $cli monitor -p $p --config baudrate=921600
  return
}

# Always pass the backend explicitly. Relying on the default in config.h
# meant that when the default flipped to SH1106 both passes below silently
# built the same thing, and the serial path went unchecked.
$SERIAL_FLAG  = 'compiler.cpp.extra_flags=-DDISPLAY_BACKEND=0'
$SH1106_FLAG = 'compiler.cpp.extra_flags=-DDISPLAY_BACKEND=1'

$props = @('--build-property', $(if ($Oled) { $SH1106_FLAG } else { $SERIAL_FLAG }))

if ($Upload) {
  $p = Find-Port
  Write-Host "compiling and uploading to $p ($(if($Oled){'SH1106'}else{'serial'}) backend)" -ForegroundColor Cyan
  & $cli compile --fqbn $fqbn @props -u -p $p $sketch
  if ($LASTEXITCODE -ne 0) { throw "upload failed" }
  Write-Host "done. run .\build.ps1 -Monitor to watch it." -ForegroundColor Green
  return
}

# Default: compile-check BOTH backends, so a change that only breaks the
# OLED path cannot pass unnoticed while the serial backend is selected.
foreach ($cfg in @(
    @{ n='serial';  p=@('--build-property', $SERIAL_FLAG)  },
    @{ n='sh1106'; p=@('--build-property', $SH1106_FLAG) })) {
  Write-Host "=== $($cfg.n) backend ===" -ForegroundColor Cyan
  & $cli compile --fqbn $fqbn @($cfg.p) $sketch
  if ($LASTEXITCODE -ne 0) { throw "$($cfg.n) backend failed to build" }
}
Write-Host "both backends build clean." -ForegroundColor Green
