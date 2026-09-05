#!/usr/bin/env sh
set -eu

# Használat a Homehub repo gyökeréből:
#   ./apply-life360-otp-patch.sh
# vagy:
#   ./apply-life360-otp-patch.sh /path/to/Homehub

ROOT="${1:-$(pwd)}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONNECTOR="$ROOT/server/connectors/life360_connector.py"
PATCHED_CONNECTOR="$SCRIPT_DIR/files/life360_connector.py"

if [ ! -f "$CONNECTOR" ]; then
  echo "ERROR: Nem találom: $CONNECTOR" >&2
  echo "Futtasd a Homehub repo gyökeréből, vagy add meg a repo elérési útját paraméterként." >&2
  exit 1
fi
if [ ! -f "$PATCHED_CONNECTOR" ]; then
  echo "ERROR: A patch connector hiányzik: $PATCHED_CONNECTOR" >&2
  exit 1
fi

SRC=$(grep -RIl --include='*.ts' --include='*.js' --exclude-dir=dist --exclude-dir=node_modules --exclude-dir=.git "class Life360Service" "$ROOT/server" 2>/dev/null | head -n 1 || true)
if [ -z "$SRC" ]; then
  echo "ERROR: Nem találom a Life360Service FORRÁSFÁJLT (dist kizárva)." >&2
  exit 1
fi

echo "Repo: $ROOT"
echo "Connector: $CONNECTOR"
echo "Service source: $SRC"

STAMP=$(date +%Y%m%d-%H%M%S)
cp "$CONNECTOR" "$CONNECTOR.bak-$STAMP"
cp "$SRC" "$SRC.bak-$STAMP"
cp "$PATCHED_CONNECTOR" "$CONNECTOR"
chmod +x "$CONNECTOR" 2>/dev/null || true

python3 - "$SRC" <<'PY'
import re, sys
from pathlib import Path

p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
orig=s

# accessToken inicializálása a Render env-ből
s,n1=re.subn(
    r'(^\s*(?:(?:private|public|protected)\s+)?accessToken\s*(?::[^=;]+)?=\s*)["\']["\'](\s*;)',
    r'\1process.env.LIFE360_ACCESS_TOKEN || ""\2',
    s,count=1,flags=re.M
)

old=r'Boolean\(process\.env\.LIFE360_USERNAME\s*&&\s*process\.env\.LIFE360_PASSWORD\)'
new='Boolean(process.env.LIFE360_ACCESS_TOKEN || (process.env.LIFE360_USERNAME && process.env.LIFE360_PASSWORD))'
s,n2=re.subn(old,new,s)

s,n3=re.subn(
    r'LIFE360_ACCESS_TOKEN\s*:\s*this\.accessToken(?!\s*\|\|)',
    'LIFE360_ACCESS_TOKEN: this.accessToken || process.env.LIFE360_ACCESS_TOKEN || ""',
    s
)

p.write_text(s,encoding='utf-8')

text=s
checks={
    'token_configured': 'process.env.LIFE360_ACCESS_TOKEN || (process.env.LIFE360_USERNAME && process.env.LIFE360_PASSWORD)' in text,
    'token_forwarded': 'this.accessToken || process.env.LIFE360_ACCESS_TOKEN || ""' in text,
}
print(f'Módosítások: accessToken-init={n1}, configured={n2}, env-forward={n3}')
for k,v in checks.items(): print(f'{k}: {v}')
if not all(checks.values()):
    print('ERROR: A Life360Service patch ellenőrzése sikertelen.',file=sys.stderr)
    sys.exit(2)
PY

echo
echo "--- Ellenőrzés ---"
grep -n "LIFE360_ACCESS_TOKEN\|LIFE360_USERNAME" "$SRC" | head -n 20 || true
grep -n "LIFE360_ACCESS_TOKEN\|LIFE360_USERNAME" "$CONNECTOR" | head -n 20 || true

echo
echo "--- Git diff ---"
git -C "$ROOT" diff -- "$CONNECTOR" "$SRC" || true

echo
echo "PATCH OK. Most commit + push kell; Render csak az új Git commitból fogja buildelni a dist fájlt."
