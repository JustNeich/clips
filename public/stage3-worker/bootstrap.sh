#!/usr/bin/env bash
set -euo pipefail

SERVER=""
TOKEN=""
LABEL=""

log() {
  printf '[Clips] %s\n' "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)
      SERVER="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SERVER" || -z "$TOKEN" ]]; then
  echo "Usage: curl -fsSL <server>/stage3-worker/bootstrap.sh | bash -s -- --server <origin> --token <pairing-token> [--label <name>]" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required to run the Clips Stage 3 worker." >&2
  echo "Install Node first, then rerun this command." >&2
  exit 1
fi
LOCAL_RUNTIME_DEPENDENCIES_PLATFORM="$(node -p "process.platform + '-' + process.arch" | tr '[:upper:]' '[:lower:]')"
log "Detected runtime dependency platform: ${LOCAL_RUNTIME_DEPENDENCIES_PLATFORM}"

INSTALL_ROOT="${HOME}/Library/Application Support/Clips Stage3 Worker"
RUNTIME_BASE="${SERVER%/}/api/stage3/worker/runtime"
BIN_DIR="${INSTALL_ROOT}/bin"
REMOTION_DIR="${INSTALL_ROOT}/remotion"
LIB_DIR="${INSTALL_ROOT}/lib"
DESIGN_DIR="${INSTALL_ROOT}/design"
PUBLIC_DIR="${INSTALL_ROOT}/public"
BUNDLE_PATH="${BIN_DIR}/clips-stage3-worker.cjs"
WRAPPER_PATH="${BIN_DIR}/clips-stage3-worker"
PACKAGE_PATH="${INSTALL_ROOT}/package.json"
MANIFEST_PATH="${INSTALL_ROOT}/manifest.json"
RUNTIME_ARCHIVE_PATH="${INSTALL_ROOT}/runtime-deps.tar.gz"
RUNTIME_SOURCES_ARCHIVE_PATH="${INSTALL_ROOT}/runtime-sources.tar.gz"

mkdir -p "$BIN_DIR"
mkdir -p "$REMOTION_DIR"
mkdir -p "$LIB_DIR"
mkdir -p "$DESIGN_DIR"
mkdir -p "$PUBLIC_DIR"
download_runtime() {
  local relative_path="$1"
  local destination="$2"
  curl -fsSL -H "X-Stage3-Worker-Pairing-Token: ${TOKEN}" "${RUNTIME_BASE}/${relative_path}" -o "$destination"
}

is_safe_runtime_file() {
  local file="$1"
  [[ -n "$file" && "$file" != /* && "$file" != *"\\"* && "$file" != *".."* ]]
}

log "Downloading worker bundle"
download_runtime "clips-stage3-worker.cjs" "$BUNDLE_PATH"
log "Downloading worker package.json"
download_runtime "package.json" "$PACKAGE_PATH"
log "Downloading worker manifest"
download_runtime "manifest.json" "$MANIFEST_PATH"

RUNTIME_SOURCES_ARCHIVE_FILE="$(
  node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const archiveFile =
  typeof manifest.runtimeSourcesArchiveFile === "string" && manifest.runtimeSourcesArchiveFile.trim()
    ? manifest.runtimeSourcesArchiveFile.trim()
    : "";
process.stdout.write(archiveFile);
' "$MANIFEST_PATH"
)"

runtime_sources_ready="false"
if [[ -n "$RUNTIME_SOURCES_ARCHIVE_FILE" ]]; then
  if ! is_safe_runtime_file "$RUNTIME_SOURCES_ARCHIVE_FILE"; then
    echo "Worker manifest contains an unsafe runtime sources archive path." >&2
    exit 1
  fi
  if command -v tar >/dev/null 2>&1; then
    log "Downloading bundled runtime sources"
    if download_runtime "${RUNTIME_SOURCES_ARCHIVE_FILE}" "$RUNTIME_SOURCES_ARCHIVE_PATH"; then
      rm -rf "$REMOTION_DIR" "$LIB_DIR" "$DESIGN_DIR" "$PUBLIC_DIR"
      mkdir -p "$REMOTION_DIR" "$LIB_DIR" "$DESIGN_DIR" "$PUBLIC_DIR"
      log "Unpacking bundled runtime sources"
      if tar -xzf "$RUNTIME_SOURCES_ARCHIVE_PATH" -C "$INSTALL_ROOT"; then
        runtime_sources_ready="true"
        log "Bundled runtime sources unpacked locally."
      else
        log "Bundled runtime sources extraction failed, falling back to per-file downloads."
      fi
    else
      log "Bundled runtime sources download failed, falling back to per-file downloads."
    fi
  else
    log "tar is unavailable on this machine, falling back to per-file runtime downloads."
  fi
  rm -f "$RUNTIME_SOURCES_ARCHIVE_PATH"
fi

if [[ "$runtime_sources_ready" != "true" ]]; then
  while IFS= read -r FILE; do
    [[ -n "$FILE" ]] || continue
    if ! is_safe_runtime_file "$FILE"; then
      echo "Worker manifest contains an unsafe remotion file path." >&2
      exit 1
    fi
    mkdir -p "$(dirname "${REMOTION_DIR}/${FILE}")"
    download_runtime "remotion/${FILE}" "${REMOTION_DIR}/${FILE}"
  done < <(
  node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const files = Array.isArray(manifest.remotionFiles) ? manifest.remotionFiles : ["index.tsx", "science-card-v1.tsx"];
for (const file of files) {
  if (typeof file === "string" && file.trim()) console.log(file.trim());
}
' "$MANIFEST_PATH"
  )
  while IFS= read -r FILE; do
    [[ -n "$FILE" ]] || continue
    if ! is_safe_runtime_file "$FILE"; then
      echo "Worker manifest contains an unsafe lib file path." >&2
      exit 1
    fi
    mkdir -p "$(dirname "${LIB_DIR}/${FILE}")"
    download_runtime "lib/${FILE}" "${LIB_DIR}/${FILE}"
  done < <(
  node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const files = Array.isArray(manifest.libFiles) ? manifest.libFiles : [
  "stage3-duration.ts",
  "stage3-template.ts",
  "stage3-template-semantics.ts",
  "stage3-template-fonts.ts",
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
  "stage3-video-adjustments.ts",
  "stage3-video-scale.ts",
  "stage3-video-placement.ts",
  "stage3-worker-job-timeout.ts"
];
for (const file of files) {
  if (typeof file === "string" && file.trim()) console.log(file.trim());
}
' "$MANIFEST_PATH"
  )
  while IFS= read -r FILE; do
    [[ -n "$FILE" ]] || continue
    if ! is_safe_runtime_file "$FILE"; then
      echo "Worker manifest contains an unsafe design file path." >&2
      exit 1
    fi
    mkdir -p "$(dirname "${DESIGN_DIR}/${FILE}")"
    download_runtime "design/${FILE}" "${DESIGN_DIR}/${FILE}"
  done < <(
  node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const files = Array.isArray(manifest.designFiles) ? manifest.designFiles : [
  "templates/hedges-of-honor-v1/figma-spec.json",
  "templates/science-card-v1/figma-spec.json",
  "templates/science-card-v7/figma-spec.json"
];
for (const file of files) {
  if (typeof file === "string" && file.trim()) console.log(file.trim());
}
' "$MANIFEST_PATH"
  )
  while IFS= read -r FILE; do
    [[ -n "$FILE" ]] || continue
    if ! is_safe_runtime_file "$FILE"; then
      echo "Worker manifest contains an unsafe public file path." >&2
      exit 1
    fi
    mkdir -p "$(dirname "${PUBLIC_DIR}/${FILE}")"
    download_runtime "public/${FILE}" "${PUBLIC_DIR}/${FILE}"
  done < <(
  node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const files = Array.isArray(manifest.publicFiles) ? manifest.publicFiles : [
  "stage3-template-backdrops/hedges-of-honor-v1-shell.svg",
  "stage3-template-backdrops/science-card-v7-shell.svg",
  "stage3-template-badges/american-news-badge.svg",
  "stage3-template-badges/gold-glow-badge.png",
  "stage3-template-badges/honor-verified-badge.svg",
  "stage3-template-badges/pink-glow-badge.png",
  "stage3-template-badges/science-card-v1-check.png",
  "stage3-template-badges/twitter-verified-badge.png"
];
for (const file of files) {
  if (typeof file === "string" && file.trim()) console.log(file.trim());
}
' "$MANIFEST_PATH"
  )
fi
chmod +x "$BUNDLE_PATH"

RUNTIME_ARCHIVE_FILE="$(
  node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const archiveFile =
  typeof manifest.runtimeDependenciesArchiveFile === "string" && manifest.runtimeDependenciesArchiveFile.trim()
    ? manifest.runtimeDependenciesArchiveFile.trim()
    : "";
process.stdout.write(archiveFile);
' "$MANIFEST_PATH"
)"
RUNTIME_ARCHIVE_PLATFORM="$(
  node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const archivePlatform =
  typeof manifest.runtimeDependenciesPlatform === "string" && manifest.runtimeDependenciesPlatform.trim()
    ? manifest.runtimeDependenciesPlatform.trim().toLowerCase()
    : "";
process.stdout.write(archivePlatform);
' "$MANIFEST_PATH"
)"

runtime_ready="false"
runtime_archive_compatible="false"
if [[ -n "$RUNTIME_ARCHIVE_FILE" && -n "$RUNTIME_ARCHIVE_PLATFORM" && "$RUNTIME_ARCHIVE_PLATFORM" == "$LOCAL_RUNTIME_DEPENDENCIES_PLATFORM" ]]; then
  if ! is_safe_runtime_file "$RUNTIME_ARCHIVE_FILE"; then
    echo "Worker manifest contains an unsafe runtime dependency archive path." >&2
    exit 1
  fi
  runtime_archive_compatible="true"
fi
if [[ -n "$RUNTIME_ARCHIVE_FILE" && "$runtime_archive_compatible" != "true" ]]; then
  runtime_archive_label="${RUNTIME_ARCHIVE_PLATFORM:-unknown platform}"
  log "Bundled runtime dependencies are for ${runtime_archive_label}, this machine is ${LOCAL_RUNTIME_DEPENDENCIES_PLATFORM}. Installing with npm instead."
  rm -rf "${INSTALL_ROOT}/node_modules"
fi
if [[ "$runtime_archive_compatible" == "true" ]]; then
  if command -v tar >/dev/null 2>&1; then
    log "Downloading bundled runtime dependencies"
    if download_runtime "${RUNTIME_ARCHIVE_FILE}" "$RUNTIME_ARCHIVE_PATH"; then
      rm -rf "${INSTALL_ROOT}/node_modules"
      log "Unpacking bundled runtime dependencies"
      if tar -xzf "$RUNTIME_ARCHIVE_PATH" -C "$INSTALL_ROOT"; then
        runtime_ready="true"
        log "Bundled runtime dependencies unpacked locally. npm registry access is not required."
      else
        log "Bundled runtime archive extraction failed, falling back to npm install."
      fi
    else
      log "Bundled runtime download failed, falling back to npm install."
    fi
  else
    log "tar is unavailable on this machine, falling back to npm install."
  fi
  rm -f "$RUNTIME_ARCHIVE_PATH"
fi

if [[ "$runtime_ready" != "true" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install the Clips Stage 3 worker runtime." >&2
    echo "Install Node.js with npm first, then rerun this command." >&2
    exit 1
  fi
  log "Installing worker runtime dependencies with npm"
  (cd "$INSTALL_ROOT" && npm install --omit=dev --no-fund --no-audit)
fi

cat > "$WRAPPER_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
cd "$ROOT"
export STAGE3_WORKER_INSTALL_ROOT="$ROOT"
exec node "$DIR/clips-stage3-worker.cjs" "$@"
EOF
chmod +x "$WRAPPER_PATH"

PAIR_ARGS=(pair --server "$SERVER" --token "$TOKEN")
if [[ -n "$LABEL" ]]; then
  PAIR_ARGS+=(--label "$LABEL")
fi

"$WRAPPER_PATH" "${PAIR_ARGS[@]}"
"$WRAPPER_PATH" doctor || true

echo
echo "Starting Clips Stage 3 worker. Keep this terminal open while Stage 3 preview/render jobs are running."
exec "$WRAPPER_PATH" start
