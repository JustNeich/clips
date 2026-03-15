#!/usr/bin/env bash
set -euo pipefail

SERVER=""
TOKEN=""
LABEL=""

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

INSTALL_ROOT="${HOME}/Library/Application Support/Clips Stage3 Worker"
BIN_DIR="${INSTALL_ROOT}/bin"
REMOTION_DIR="${INSTALL_ROOT}/remotion"
LIB_DIR="${INSTALL_ROOT}/lib"
PUBLIC_DIR="${INSTALL_ROOT}/public"
BUNDLE_PATH="${BIN_DIR}/clips-stage3-worker.cjs"
WRAPPER_PATH="${BIN_DIR}/clips-stage3-worker"
PACKAGE_PATH="${INSTALL_ROOT}/package.json"
MANIFEST_PATH="${INSTALL_ROOT}/manifest.json"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install the Clips Stage 3 worker runtime." >&2
  echo "Install Node.js with npm first, then rerun this command." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
mkdir -p "$REMOTION_DIR"
mkdir -p "$LIB_DIR"
mkdir -p "$PUBLIC_DIR"
curl -fsSL "${SERVER%/}/stage3-worker/clips-stage3-worker.cjs" -o "$BUNDLE_PATH"
curl -fsSL "${SERVER%/}/stage3-worker/package.json" -o "$PACKAGE_PATH"
curl -fsSL "${SERVER%/}/stage3-worker/manifest.json" -o "$MANIFEST_PATH"
REMOTION_FILES=(
  "index.tsx"
  "science-card-v1.tsx"
)
LIB_FILES=(
  "stage3-template.ts"
  "stage3-constants.ts"
  "template-scene.tsx"
  "template-calibration-types.ts"
  "auto-fit-template-scene.tsx"
  "stage3-template-core.ts"
  "stage3-template-renderer.tsx"
  "stage3-template-runtime.tsx"
  "stage3-template-registry.ts"
)
for FILE in "${REMOTION_FILES[@]}"; do
  curl -fsSL "${SERVER%/}/stage3-worker/remotion/${FILE}" -o "${REMOTION_DIR}/${FILE}"
done
for FILE in "${LIB_FILES[@]}"; do
  curl -fsSL "${SERVER%/}/stage3-worker/lib/${FILE}" -o "${LIB_DIR}/${FILE}"
done
chmod +x "$BUNDLE_PATH"

(cd "$INSTALL_ROOT" && npm install --omit=dev --no-fund --no-audit)

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
