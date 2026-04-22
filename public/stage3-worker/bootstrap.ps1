$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-ClipsStage3BootstrapLog {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("INFO", "WARN", "ERROR")][string]$Level = "INFO"
  )

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$timestamp][$Level] $Message"
  Write-Host $line
  if ($script:BootstrapLogPath) {
    Add-Content -Path $script:BootstrapLogPath -Value $line -Encoding UTF8
  }
}

function Invoke-ClipsStage3Download {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Write-ClipsStage3BootstrapLog "Downloading $Label"
  Invoke-WebRequest $Uri -UseBasicParsing -ErrorAction Stop -OutFile $OutFile
}

function Expand-ClipsStage3RuntimeArchive {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $tar = Get-Command tar -ErrorAction SilentlyContinue
  if (-not $tar) {
    throw "tar is not available on this machine."
  }

  $nodeModulesPath = Join-Path $Destination "node_modules"
  if (Test-Path $nodeModulesPath) {
    Remove-Item $nodeModulesPath -Recurse -Force -ErrorAction SilentlyContinue
  }

  & $tar.Source -xzf $ArchivePath -C $Destination
  if ($LASTEXITCODE -ne 0) {
    throw "tar extraction failed with exit code $LASTEXITCODE."
  }
}

function Install-ClipsStage3Worker {
  param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Label = ""
  )

  $serverOrigin = $Server.TrimEnd("/")
  $installRoot = Join-Path $env:LOCALAPPDATA "Clips Stage3 Worker"
  $logDir = Join-Path $installRoot "logs"
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $script:BootstrapLogPath = Join-Path $logDir ("bootstrap-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
  New-Item -ItemType File -Path $script:BootstrapLogPath -Force | Out-Null

  Write-ClipsStage3BootstrapLog "Bootstrap log: $script:BootstrapLogPath"
  Write-ClipsStage3BootstrapLog "Preparing Stage 3 worker install for $serverOrigin"

  try {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      throw "Node.js 22+ is required to run the Clips Stage 3 worker. Install Node first, then rerun this command."
    }
    Write-ClipsStage3BootstrapLog "Detected node: $($node.Source)"

    $binDir = Join-Path $installRoot "bin"
    $remotionDir = Join-Path $installRoot "remotion"
    $libDir = Join-Path $installRoot "lib"
    $designDir = Join-Path $installRoot "design"
    $publicDir = Join-Path $installRoot "public"
    $bundlePath = Join-Path $binDir "clips-stage3-worker.cjs"
    $wrapperPath = Join-Path $binDir "clips-stage3-worker.cmd"
    $packagePath = Join-Path $installRoot "package.json"
    $manifestPath = Join-Path $installRoot "manifest.json"
    $runtimeArchivePath = Join-Path $installRoot "runtime-deps.tar.gz"
    $runtimeSourcesArchivePath = Join-Path $installRoot "runtime-sources.tar.gz"

    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    New-Item -ItemType Directory -Path $remotionDir -Force | Out-Null
    New-Item -ItemType Directory -Path $libDir -Force | Out-Null
    New-Item -ItemType Directory -Path $designDir -Force | Out-Null
    New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
    Write-ClipsStage3BootstrapLog "Install root: $installRoot"

    Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/clips-stage3-worker.cjs" -OutFile $bundlePath -Label "worker bundle"
    Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/package.json" -OutFile $packagePath -Label "worker package.json"
    Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/manifest.json" -OutFile $manifestPath -Label "worker manifest"

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
        "stage3-template-semantics.ts",
        "stage3-constants.ts",
        "template-scene.tsx",
        "stage3-verified-badge.tsx",
        "template-calibration-types.ts",
        "auto-fit-template-scene.tsx",
        "stage3-template-core.ts",
        "template-highlights.ts",
        "stage3-render-variation.ts",
        "stage3-camera.ts",
        "stage3-text-fit.ts",
        "stage3-template-spec.ts",
        "stage3-template-renderer.tsx",
        "stage3-template-runtime.tsx",
        "stage3-template-registry.ts",
        "stage3-background-mode.ts",
        "stage3-video-adjustments.ts"
      )
    }
    $designFiles = @($manifest.designFiles)
    if ($designFiles.Count -eq 0) {
      $designFiles = @(
        "templates/american-news-v1/figma-spec.json",
        "templates/channel-story-v1/figma-spec.json",
        "templates/science-card-blue-v1/figma-spec.json",
        "templates/science-card-green-v1/figma-spec.json",
        "templates/science-card-red-v1/figma-spec.json",
        "templates/science-card-v1/figma-spec.json",
        "templates/science-card-v7/figma-spec.json",
        "templates/hedges-of-honor-v1/figma-spec.json"
      )
    }
    $publicFiles = @($manifest.publicFiles)
    if ($publicFiles.Count -eq 0) {
      $publicFiles = @(
        "stage3-template-badges/science-card-v1-check.png",
        "stage3-template-badges/honor-verified-badge.svg",
        "stage3-template-backdrops/science-card-v7-shell.svg",
        "stage3-template-backdrops/hedges-of-honor-v1-shell.svg"
      )
    }
    $runtimeArchiveRelativePath =
      if ($manifest.runtimeDependenciesArchiveFile -is [string]) {
        $manifest.runtimeDependenciesArchiveFile.Trim()
      } else {
        ""
      }
    $runtimeSourcesArchiveRelativePath =
      if ($manifest.runtimeSourcesArchiveFile -is [string]) {
        $manifest.runtimeSourcesArchiveFile.Trim()
      } else {
        ""
      }

    $runtimeSourcesReady = $false
    if ($runtimeSourcesArchiveRelativePath) {
      try {
        Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/$runtimeSourcesArchiveRelativePath" -OutFile $runtimeSourcesArchivePath -Label "bundled runtime sources"
        Remove-Item $remotionDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $libDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $designDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $publicDir -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $remotionDir -Force | Out-Null
        New-Item -ItemType Directory -Path $libDir -Force | Out-Null
        New-Item -ItemType Directory -Path $designDir -Force | Out-Null
        New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
        Write-ClipsStage3BootstrapLog "Unpacking bundled runtime sources"
        Expand-ClipsStage3RuntimeArchive -ArchivePath $runtimeSourcesArchivePath -Destination $installRoot
        $runtimeSourcesReady =
          (Test-Path $remotionDir) -and
          (Test-Path $libDir) -and
          (Test-Path $designDir) -and
          (Test-Path $publicDir)
        if (-not $runtimeSourcesReady) {
          throw "Bundled runtime sources archive did not recreate the expected folders."
        }
        Write-ClipsStage3BootstrapLog "Bundled runtime sources unpacked locally."
      } catch {
        $message = if ($_.Exception) { $_.Exception.Message } else { "$_" }
        Write-ClipsStage3BootstrapLog "Bundled runtime sources failed, falling back to per-file downloads: $message" "WARN"
      } finally {
        if (Test-Path $runtimeSourcesArchivePath) {
          Remove-Item $runtimeSourcesArchivePath -Force -ErrorAction SilentlyContinue
        }
      }
    }

    if (-not $runtimeSourcesReady) {
      Write-ClipsStage3BootstrapLog "Downloading remotion files: $($remotionFiles.Count)"
      foreach ($file in $remotionFiles) {
        $destination = Join-Path $remotionDir $file
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/remotion/$file" -OutFile $destination -Label "remotion/$file"
      }

      Write-ClipsStage3BootstrapLog "Downloading lib files: $($libFiles.Count)"
      foreach ($file in $libFiles) {
        $destination = Join-Path $libDir $file
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/lib/$file" -OutFile $destination -Label "lib/$file"
      }

      Write-ClipsStage3BootstrapLog "Downloading design files: $($designFiles.Count)"
      foreach ($file in $designFiles) {
        $destination = Join-Path $designDir $file
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/design/$file" -OutFile $destination -Label "design/$file"
      }

      Write-ClipsStage3BootstrapLog "Downloading public assets: $($publicFiles.Count)"
      foreach ($file in $publicFiles) {
        $destination = Join-Path $publicDir $file
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/public/$file" -OutFile $destination -Label "public/$file"
      }
    }

    @"
@echo off
set STAGE3_WORKER_INSTALL_ROOT=%~dp0..
cd /d "%~dp0.."
node "%~dp0clips-stage3-worker.cjs" %*
"@ | Set-Content -Path $wrapperPath -Encoding Ascii

    $runtimeReady = $false
    if ($runtimeArchiveRelativePath) {
      try {
        Invoke-ClipsStage3Download -Uri "$serverOrigin/stage3-worker/$runtimeArchiveRelativePath" -OutFile $runtimeArchivePath -Label "bundled runtime dependencies"
        Write-ClipsStage3BootstrapLog "Unpacking bundled runtime dependencies"
        Expand-ClipsStage3RuntimeArchive -ArchivePath $runtimeArchivePath -Destination $installRoot
        $runtimeReady = Test-Path (Join-Path $installRoot "node_modules")
        if (-not $runtimeReady) {
          throw "Bundled runtime archive did not create node_modules."
        }
        Write-ClipsStage3BootstrapLog "Bundled runtime dependencies unpacked locally. npm registry access is not required."
      } catch {
        $message = if ($_.Exception) { $_.Exception.Message } else { "$_" }
        Write-ClipsStage3BootstrapLog "Bundled runtime install failed, falling back to npm install: $message" "WARN"
      } finally {
        if (Test-Path $runtimeArchivePath) {
          Remove-Item $runtimeArchivePath -Force -ErrorAction SilentlyContinue
        }
      }
    }

    if (-not $runtimeReady) {
      $npm = Get-Command npm -ErrorAction SilentlyContinue
      if (-not $npm) {
        throw "npm is required to install the Clips Stage 3 worker runtime. Install Node.js with npm first, then rerun this command."
      }
      Write-ClipsStage3BootstrapLog "Detected npm: $($npm.Source)"
      Write-ClipsStage3BootstrapLog "Installing worker runtime dependencies with npm"
      Push-Location $installRoot
      try {
        & $npm.Source install --omit=dev --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) {
          throw "npm install failed with exit code $LASTEXITCODE."
        }
      } finally {
        Pop-Location
      }
    }

    $pairArgs = @("pair", "--server", $Server, "--token", $Token)
    if ($Label) {
      $pairArgs += @("--label", $Label)
    }

    Write-ClipsStage3BootstrapLog "Pairing Stage 3 worker"
    & $wrapperPath @pairArgs
    if ($LASTEXITCODE -ne 0) {
      throw "Stage 3 worker pairing failed. Open Step 3, copy a fresh command and run it again."
    }

    Write-ClipsStage3BootstrapLog "Running worker doctor"
    try {
      & $wrapperPath doctor
    } catch {
      Write-ClipsStage3BootstrapLog "Doctor reported a non-fatal problem: $($_.Exception.Message)" "WARN"
    }

    Write-ClipsStage3BootstrapLog "Starting Clips Stage 3 worker. Keep this PowerShell window open while Stage 3 preview/render jobs are running."
    & $wrapperPath start
  } catch {
    $message = if ($_.Exception) { $_.Exception.Message } else { "$_" }
    Write-ClipsStage3BootstrapLog "Bootstrap failed: $message" "ERROR"
    Write-ClipsStage3BootstrapLog "Share this log with support: $script:BootstrapLogPath" "ERROR"
    throw
  }
}
