#!/usr/bin/env sh
set -eu
python3 - <<'PY'
import os, json, urllib.request, urllib.error

token=os.environ.get('LIFE360_ACCESS_TOKEN','').strip()
circle=os.environ.get('LIFE360_CIRCLE_ID','').strip()
print('LIFE360_ACCESS_TOKEN present:', bool(token), 'length:', len(token))
print('LIFE360_CIRCLE_ID present:', bool(circle))
if not token or not circle:
    raise SystemExit(2)
headers={
    'Accept':'application/json',
    'Cache-Control':'no-cache',
    'User-Agent':'com.life360.android.safetymapd/KOKO/23.50.0 android/13',
    'Authorization':'Bearer '+token,
}
for label,url in [
    ('circles','https://api-cloudfront.life360.com/v4/circles'),
    ('members',f'https://api-cloudfront.life360.com/v3/circles/{circle}/members'),
]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=25) as r:
            data=json.load(r)
            print(label, 'HTTP', r.status)
            if label=='circles': print('circles:', len(data.get('circles',[])))
            else:
                members=data.get('members',[])
                print('members:', len(members))
                if members:
                    print('member fields:', sorted(members[0].keys()))
                    print('location fields:', sorted((members[0].get('location') or {}).keys()))
    except urllib.error.HTTPError as e:
        print(label,'HTTP',e.code)
        print(e.read(500).decode('utf-8','replace'))
        raise SystemExit(3)
PY
