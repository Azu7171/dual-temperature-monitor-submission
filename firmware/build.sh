#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKETCH="$SCRIPT_DIR/dual_temp_monitor"
FQBN="${FQBN:-esp32:esp32:esp32}"
CLI="${ARDUINO_CLI:-arduino-cli}"
MODE="build"
BACKEND="1"
PORT=""

usage() {
  cat <<'EOF'
Usage:
  ./build.sh                         Compile serial and SH1106 backends
  ./build.sh --upload --port PORT    Compile and upload the SH1106 build
  ./build.sh --upload --serial --port PORT
  ./build.sh --monitor --port PORT   Open serial monitor at 921600 baud

Find PORT with: arduino-cli board list
EOF
}

while (($#)); do
  case "$1" in
    --upload) MODE="upload" ;;
    --monitor) MODE="monitor" ;;
    --serial) BACKEND="0" ;;
    --oled|--sh1106) BACKEND="1" ;;
    --port)
      shift
      [[ $# -gt 0 ]] || { echo "--port requires a value" >&2; exit 2; }
      PORT="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

compile_backend() {
  local backend="$1"
  local name="serial"
  [[ "$backend" == "1" ]] && name="SH1106"
  echo "Compiling $name backend..."
  "$CLI" compile \
    --fqbn "$FQBN" \
    --build-property "compiler.cpp.extra_flags=-DDISPLAY_BACKEND=$backend" \
    "$SKETCH"
}

if [[ "$MODE" == "monitor" ]]; then
  [[ -n "$PORT" ]] || { echo "Pass the board port with --port." >&2; exit 2; }
  exec "$CLI" monitor --port "$PORT" --config baudrate=921600
fi

if [[ "$MODE" == "upload" ]]; then
  [[ -n "$PORT" ]] || { echo "Pass the board port with --port." >&2; exit 2; }
  "$CLI" compile \
    --fqbn "$FQBN" \
    --build-property "compiler.cpp.extra_flags=-DDISPLAY_BACKEND=$BACKEND" \
    --upload \
    --port "$PORT" \
    "$SKETCH"
  echo "Upload complete. Monitor with: ./build.sh --monitor --port $PORT"
  exit 0
fi

compile_backend 0
compile_backend 1
echo "Both display backends compiled successfully."
