#!/usr/bin/env sh
set -eu

ROOT="${1:-.}"
CONNECTOR="$ROOT/server/connectors/life360_connector.py"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATCHED_CONNECTOR="$SCRIPT_DIR/files/life360_connector.py"

if [ ! -f "$CONNECTOR" ]; then
  echo "ERROR: Nem találom: $CONNECTOR" >&2
  echo "A scriptet a Homehub repo gyökeréből futtasd, vagy add meg a repo útvonalát paraméterként." >&2
  exit 1
fi

SRC=$(grep -RIl --exclude-dir=dist --exclude-dir=node_modules --exclude-dir=.git "class Life360Service" "$ROOT/server" 2>/dev/null | head -n 1 || true)
if [ -z "$SRC" ]; then
  echo "ERROR: Nem találom a Life360Service forrásfájlt a server könyvtárban (dist kizárva)." >&2
  echo "A buildelt /server/dist/life360.js fájlt szándékosan nem módosítom, mert deploykor felülíródna." >&2
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
cp "$CONNECTOR" "$CONNECTOR.bak-$STAMP"
cp "$SRC" "$SRC.bak-$STAMP"
cp "$PATCHED_CONNECTOR" "$CONNECTOR"
chmod +x "$CONNECTOR" 2>/dev/null || true

echo "Connector frissítve: $CONNECTOR"
echo "Life360 service forrás: $SRC"

python3 - "$SRC" <<'PY'
import re, sys
from pathlib import Path

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
orig = s

# 1) Preserve Render-provided access token from process start.
s, n1 = re.subn(
    r'(^\s*(?:(?:private|public|protected)\s+)?accessToken\s*(?::[^=;]+)?=\s*)["\']["\'](\s*;)',
    r'\1process.env.LIFE360_ACCESS_TOKEN || ""\2',
    s,
    count=1,
    flags=re.M,
)

# 2) Treat access-token-only OTP configuration as configured.
old_cfg = r'Boolean\(process\.env\.LIFE360_USERNAME\s*&&\s*process\.env\.LIFE360_PASSWORD\)'
new_cfg = 'Boolean(process.env.LIFE360_ACCESS_TOKEN || (process.env.LIFE360_USERNAME && process.env.LIFE360_PASSWORD))'
s, n2 = re.subn(old_cfg, new_cfg, s)

# 3) Never overwrite the Render token with an empty in-memory token.
s, n3 = re.subn(
    r'LIFE360_ACCESS_TOKEN\s*:\s*this\.accessToken(?!\s*\|\|)',
    'LIFE360_ACCESS_TOKEN: this.accessToken || process.env.LIFE360_ACCESS_TOKEN || ""',
    s,
)

if s == orig:
    # Allow re-running when already patched.
    already = (
        'process.env.LIFE360_ACCESS_TOKEN || (process.env.LIFE360_USERNAME && process.env.LIFE360_PASSWORD)' in s
        and 'this.accessToken || process.env.LIFE360_ACCESS_TOKEN || ""' in s
    )
    if already:
        print('Life360Service már OTP/access-token kompatibilisnek tűnik; nincs további módosítás.')
        sys.exit(0)
    print('ERROR: A várt mintákat nem találtam a Life360Service forrásban; nem módosítottam a fájlt.', file=sys.stderr)
    sys.exit(2)

p.write_text(s, encoding='utf-8')
print(f'Life360Service módosítva: accessToken-init={n1}, configured={n2}, env-forward={n3}')
if n2 < 1 or n3 < 1:
    print('WARNING: Nem minden várt minta módosult. Ellenőrizd a diffet commit előtt.', file=sys.stderr)
PY

echo
echo "Kész. Ellenőrzés:"
echo "  git diff -- $CONNECTOR $SRC"
echo
echo "Ezután build/test, commit és push. Render a main branch új commitját automatikusan deployolhatja."
