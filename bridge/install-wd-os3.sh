#!/bin/sh
set -eu
BASE=/DataVolume/homehub
BIN_SRC=${1:-./homehub-bridge-linux-armv7}
CFG_SRC=${2:-./config.json}

if [ "$(id -u)" != "0" ]; then
  echo "Run as root on the WD My Cloud." >&2
  exit 1
fi
if [ ! -f "$BIN_SRC" ]; then echo "Missing bridge binary: $BIN_SRC" >&2; exit 1; fi
if [ ! -f "$CFG_SRC" ]; then echo "Missing config: $CFG_SRC" >&2; exit 1; fi

mkdir -p "$BASE"
cp "$BIN_SRC" "$BASE/homehub-bridge"
cp "$CFG_SRC" "$BASE/config.json"
chmod 755 "$BASE/homehub-bridge"
chmod 600 "$BASE/config.json"

cat > /etc/init.d/homehub-bridge <<'EOF'
#!/bin/sh
### BEGIN INIT INFO
# Provides:          homehub-bridge
# Required-Start:    $network $remote_fs
# Required-Stop:     $network $remote_fs
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: HomeHub NAS bridge
### END INIT INFO
BASE=/DataVolume/homehub
BIN=$BASE/homehub-bridge
CFG=$BASE/config.json
PID=/var/run/homehub-bridge.pid
LOG=$BASE/homehub.log
case "$1" in
  start)
    [ -x "$BIN" ] || exit 1
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then exit 0; fi
    echo "Starting HomeHub bridge"
    nohup "$BIN" -config "$CFG" >>"$LOG" 2>&1 &
    echo $! > "$PID"
    ;;
  stop)
    if [ -f "$PID" ]; then
      kill "$(cat "$PID")" 2>/dev/null || true
      rm -f "$PID"
    fi
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then echo "running pid $(cat "$PID")"; exit 0; fi
    echo "stopped"; exit 3
    ;;
  *) echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac
EOF
chmod 755 /etc/init.d/homehub-bridge
if command -v update-rc.d >/dev/null 2>&1; then
  update-rc.d homehub-bridge defaults >/dev/null 2>&1 || true
fi

echo "Installed to $BASE"
echo "Test first: $BASE/homehub-bridge -check -config $BASE/config.json"
echo "Then start: /etc/init.d/homehub-bridge start"
