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
  $designDir = Join-Path $installRoot "design"
  $publicDir = Join-Path $installRoot "public"
  $bundlePath = Join-Path $binDir "clips-stage3-worker.cjs"
  $wrapperPath = Join-Path $binDir "clips-stage3-worker.cmd"
  $packagePath = Join-Path $installRoot "package.json"
  $manifestPath = Join-Path $installRoot "manifest.json"

  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  New-Item -ItemType Directory -Path $remotionDir -Force | Out-Null
  New-Item -ItemType Directory -Path $libDir -Force | Out-Null
  New-Item -ItemType Directory -Path $designDir -Force | Out-Null
  New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/clips-stage3-worker.cjs" -OutFile $bundlePath
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/package.json" -OutFile $packagePath
  Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/manifest.json" -OutFile $manifestPath
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $remotionFiles = @($manifest.remotionFiles)
  if ($remotionFiles.Count -eq 0) {
    $remotionFiles = @(
      "index.tsx",
      "science-card-v1.tsx"
    )
  }
  $libFiles = @($manifest.libFiles)
  if ($libFiles.Count -eq 0) {
    $libFiles = @(
      "stage3-template.ts",
      "stage3-constants.ts",
      "template-scene.tsx",
      "template-calibration-types.ts",
      "auto-fit-template-scene.tsx",
      "stage3-template-core.ts",
      "stage3-render-variation.ts",
      "stage3-template-spec.ts",
      "stage3-template-renderer.tsx",
      "stage3-template-runtime.tsx",
      "stage3-template-registry.ts"
    )
  }
  $designFiles = @($manifest.designFiles)
  if ($designFiles.Count -eq 0) {
    $designFiles = @(
      "templates/science-card-v1/figma-spec.json"
    )
  }
  $publicFiles = @($manifest.publicFiles)
  if ($publicFiles.Count -eq 0) {
    $publicFiles = @(
      "stage3-template-badges/science-card-v1-check.png",
      "stage3-template-backdrops/science-card-v2.png"
    )
  }
  foreach ($file in $remotionFiles) {
    $destination = Join-Path $remotionDir $file
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/remotion/$file" -OutFile $destination
  }
  foreach ($file in $libFiles) {
    $destination = Join-Path $libDir $file
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/lib/$file" -OutFile $destination
  }
  foreach ($file in $designFiles) {
    $destination = Join-Path $designDir $file
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/design/$file" -OutFile $destination
  }
  foreach ($file in $publicFiles) {
    $destination = Join-Path $publicDir $file
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Invoke-WebRequest "$($Server.TrimEnd('/'))/stage3-worker/public/$file" -OutFile $destination
  }
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
  if ($LASTEXITCODE -ne 0) {
    throw "Stage 3 worker pairing failed. Open Step 3, copy a fresh command and run it again."
  }
  try {
    & $wrapperPath doctor
  } catch {
  }

  Write-Host ""
  Write-Host "Starting Clips Stage 3 worker. Keep this PowerShell window open while Stage 3 preview/render jobs are running."
  & $wrapperPath start
}
