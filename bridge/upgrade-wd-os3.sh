#!/bin/sh
set -eu
BASE=/DataVolume/homehub
BIN_SRC=${1:-./homehub-bridge-linux-armv7}

if [ "$(id -u)" != "0" ]; then
  echo "Run as root on the WD My Cloud." >&2
  exit 1
fi
if [ ! -f "$BIN_SRC" ]; then
  echo "Missing bridge binary: $BIN_SRC" >&2
  exit 1
fi
if [ ! -f "$BASE/config.json" ]; then
  echo "Existing HomeHub config not found: $BASE/config.json" >&2
  exit 1
fi

"/etc/init.d/homehub-bridge" stop 2>/dev/null || true
cp "$BIN_SRC" "$BASE/homehub-bridge.new"
chmod 755 "$BASE/homehub-bridge.new"
mv "$BASE/homehub-bridge.new" "$BASE/homehub-bridge"
"$BASE/homehub-bridge" -version
"/etc/init.d/homehub-bridge" start
sleep 2
"/etc/init.d/homehub-bridge" status || true

echo "HomeHub Bridge upgraded without overwriting $BASE/config.json"
echo "Media health on the home LAN: http://192.168.1.180:8788/health"
