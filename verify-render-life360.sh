#!/usr/bin/env sh
set -eu
python3 - <<'PY'
import os, json, urllib.request, urllib.error

token = os.getenv('LIFE360_ACCESS_TOKEN', '').strip()
circle = os.getenv('LIFE360_CIRCLE_ID', '').strip()
print('LIFE360_ACCESS_TOKEN present:', bool(token))
print('LIFE360_ACCESS_TOKEN length:', len(token))
print('LIFE360_CIRCLE_ID present:', bool(circle))
if not token:
    raise SystemExit('Missing LIFE360_ACCESS_TOKEN')

headers = {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache',
    'User-Agent': 'com.life360.android.safetymapd/KOKO/23.50.0 android/13',
    'Authorization': 'Bearer ' + token,
}

def get(url):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.status, json.load(r)

try:
    status, circles = get('https://api-cloudfront.life360.com/v4/circles')
    print('circles HTTP:', status)
    found = circles.get('circles', [])
    print('circles:', len(found))
    selected = next((c for c in found if c.get('id') == circle), found[0] if found else None)
    if not selected:
        raise SystemExit('No circle available')
    print('selected circle:', selected.get('name'), selected.get('id'))
    status, members = get('https://api-cloudfront.life360.com/v3/circles/%s/members' % selected['id'])
    ms = members.get('members', [])
    print('members HTTP:', status)
    print('members:', len(ms))
    if ms:
        print('member fields:', sorted(ms[0].keys()))
        loc = ms[0].get('location') or {}
        print('location fields:', sorted(loc.keys()))
except urllib.error.HTTPError as e:
    print('HTTP', e.code)
    print(e.read(600).decode('utf-8', 'replace'))
    raise SystemExit(2)
PY
