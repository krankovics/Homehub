#!/bin/sh
set -eu
BASE=/DataVolume/homehub
OUT="$BASE/network-secrets.json"

if [ "$(id -u)" != "0" ]; then
  echo "Run as root on the WD My Cloud." >&2
  exit 1
fi
mkdir -p "$BASE"
printf "TL-SG108E username [admin]: "
read USERNAME
USERNAME=${USERNAME:-admin}
printf "TL-SG108E local admin password: "
stty -echo
read PASSWORD
stty echo
printf "\n"
if [ -z "$PASSWORD" ]; then
  echo "Password cannot be empty." >&2
  exit 1
fi
# JSON escaping for backslash and quote is sufficient for ordinary credentials.
ESC_USER=$(printf '%s' "$USERNAME" | sed 's/\\/\\\\/g; s/"/\\"/g')
ESC_PASS=$(printf '%s' "$PASSWORD" | sed 's/\\/\\\\/g; s/"/\\"/g')
umask 077
cat > "$OUT" <<JSON
{
  "devices": {
    "tl-sg108e": {
      "username": "$ESC_USER",
      "password": "$ESC_PASS"
    }
  }
}
JSON
chmod 600 "$OUT"
echo "Saved: $OUT (mode 600)"
echo "Restarting HomeHub Bridge..."
/etc/init.d/homehub-bridge restart
sleep 2
/etc/init.d/homehub-bridge status || true
