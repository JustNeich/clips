function Install-ClipsStage3Worker {
  param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Label = ""
  )

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js 22+ is required to run the Clips Stage 3 worker. Install Node first, then rerun this command."
  }
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "npm is required to install the Clips Stage 3 worker runtime. Install Node.js with npm first, then rerun this command."
  }

  $installRoot = Join-Path $env:LOCALAPPDATA "Clips Stage3 Worker"
  $binDir = Join-Path $installRoot "bin"
  $remotionDir = Join-Path $installRoot "remotion"
  $libDir = Join-Path $installRoot "lib"
  $publicDir = Join-Path $installRoot "public"
  $bundlePath = Join-Path $binDir "clips-stage3-worker.cjs"
  $wrapperPath = Join-Path $binDir "clips-stage3-worker.cmd"
  $packagePath = Join-Path $installRoot "package.json"

  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  New-Item -ItemType Directory -Path $remotionDir -Force | Out-Null
  New-Item -ItemType Directory -Path $libDir -Force | Out-Null
  New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/clips-stage3-worker.cjs" -OutFile $bundlePath
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/package.json" -OutFile $packagePath
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/remotion/index.tsx" -OutFile (Join-Path $remotionDir "index.tsx")
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/remotion/science-card-v1.tsx" -OutFile (Join-Path $remotionDir "science-card-v1.tsx")
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/lib/stage3-template.ts" -OutFile (Join-Path $libDir "stage3-template.ts")
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/lib/stage3-constants.ts" -OutFile (Join-Path $libDir "stage3-constants.ts")
  Push-Location $installRoot
  try {
    npm install --omit=dev --no-fund --no-audit
  } finally {
    Pop-Location
  }

  @"
@echo off
set STAGE3_WORKER_INSTALL_ROOT=%~dp0..
cd /d "%~dp0.."
node "%~dp0clips-stage3-worker.cjs" %*
"@ | Set-Content -Path $wrapperPath -Encoding Ascii

  $pairArgs = @("pair", "--server", $Server, "--token", $Token)
  if ($Label) {
    $pairArgs += @("--label", $Label)
  }

  & $wrapperPath @pairArgs
  try {
    & $wrapperPath doctor
  } catch {
  }

  Write-Host ""
  Write-Host "Starting Clips Stage 3 worker. Keep this PowerShell window open while Stage 3 preview/render jobs are running."
  & $wrapperPath start
}
