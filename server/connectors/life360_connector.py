#!/usr/bin/env python3
import json, os, sys, urllib.request, urllib.parse, urllib.error

HOST=os.getenv('LIFE360_HOST','https://api-cloudfront.life360.com').rstrip('/')
UA=os.getenv('LIFE360_USER_AGENT','com.life360.android.safetymapd/KOKO/23.50.0 android/13')
CLIENT=os.getenv('LIFE360_CLIENT_TOKEN','Y2F0aGFwYWNyQVBoZUtVc3RlOGV2ZXZldnVjSGFmZVRydVl1ZnJhYzpkOEM5ZVlVdkE2dUZ1YnJ1SmVnZXRyZVZ1dFJlQ1JVWQ==')

def req(url, method='GET', data=None, auth=''):
    headers={'Accept':'application/json','Cache-Control':'no-cache','User-Agent':UA}
    if auth:
        headers['Authorization']=auth
    body=urllib.parse.urlencode(data).encode() if data is not None else None
    r=urllib.request.Request(url,data=body,headers=headers,method=method)
    try:
        with urllib.request.urlopen(r, timeout=float(os.getenv('LIFE360_HTTP_TIMEOUT','25'))) as x:
            return json.loads(x.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        msg=e.read(512).decode('utf-8','replace')
        raise RuntimeError('Life360 HTTP %s: %s' % (e.code,msg[:300]))

def main():
    token=os.getenv('LIFE360_ACCESS_TOKEN','').strip()
    user=os.getenv('LIFE360_USERNAME','').strip()
    pw=os.getenv('LIFE360_PASSWORD','').strip()

    # OTP-s fióknál a webes OTP POST válasz access_token értékét használjuk közvetlenül.
    # A régi user/password flow csak visszafelé kompatibilis fallback.
    if not token:
        if not user or not pw:
            raise RuntimeError('LIFE360_ACCESS_TOKEN missing')
        t=req(HOST+'/v3/oauth2/token','POST',{
            'grant_type':'password','username':user,'password':pw
        },'Basic '+CLIENT)
        token=t.get('access_token','')
        if not token:
            raise RuntimeError('Life360 login did not return access_token')

    auth='Bearer '+token
    circles=req(HOST+'/v4/circles',auth=auth).get('circles',[])
    wanted=os.getenv('LIFE360_CIRCLE_ID','').strip()
    circle=next((c for c in circles if c.get('id')==wanted), circles[0] if circles else None)
    if not circle:
        raise RuntimeError('No Life360 circle available')
    members=req(HOST+'/v3/circles/%s/members' % circle['id'],auth=auth).get('members',[])
    print(json.dumps({
        'accessToken':token,
        'circleId':circle.get('id'),
        'circleName':circle.get('name'),
        'members':members
    }, separators=(',',':')))

if __name__=='__main__':
    try:
        main()
    except Exception as e:
        sys.stderr.write(str(e)+'\n')
        sys.exit(2)
