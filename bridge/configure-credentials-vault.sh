#!/bin/sh
set -eu
BRIDGE=${BRIDGE:-/DataVolume/homehub/homehub-bridge}
CONFIG=${CONFIG:-/DataVolume/homehub/config.json}
if [ -x "$BRIDGE" ]; then
  "$BRIDGE" -vault-status -config "$CONFIG" || true
fi
cat <<'TXT'

Nyisd meg otthoni halozatrol:
  http://192.168.1.180:8788/vault

Elso alkalommal allits be legalabb 6 karakteres PIN-t, majd add meg az admin
hozzafereseket. Jelszot ne adj meg parancssori parameterkent.
TXT
