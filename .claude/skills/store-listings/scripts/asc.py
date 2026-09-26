#!/usr/bin/env python3
"""App Store Connect helper for Dainvo's iOS and Mac listings.

Needs: pip install pyjwt cryptography requests
Credentials come from env vars with the owner's defaults (never commit the .p8):
  ASC_KEY_PATH  ~/Documents/Keys/Dainvo/AuthKey_8X7T9V578J.p8
  ASC_KEY_ID    8X7T9V578J
  ASC_ISSUER_ID 7758a162-4263-4547-b64b-609fbf9124c7

Commands (read-only unless noted):
  apps                                   list apps and their versions
  locales VERSION_ID                     list a version's localizations and fields
  set VERSION_ID LOCALE FIELD FILE       write one field from a UTF-8 text file (write)
                                          FIELD: description keywords promotionalText whatsNew
                                                 name subtitle  (name/subtitle go to the
                                                 app info that is being prepared)
  clear VERSION_ID FIELD                 empty FIELD on every localization (write)
  screenshots VERSION_ID LOCALE TYPE DIR replace that set with DIR/*.png in name order (write)
                                          TYPE: APP_IPHONE_67  APP_IPAD_PRO_3GEN_129  APP_DESKTOP
"""
import glob, hashlib, json, os, sys, time

import jwt
import requests

KEY_PATH = os.path.expanduser(os.environ.get('ASC_KEY_PATH', '~/Documents/Keys/Dainvo/AuthKey_8X7T9V578J.p8'))
KEY_ID = os.environ.get('ASC_KEY_ID', '8X7T9V578J')
ISSUER = os.environ.get('ASC_ISSUER_ID', '7758a162-4263-4547-b64b-609fbf9124c7')
BASE = 'https://api.appstoreconnect.apple.com'


def token():
    now = int(time.time())
    return jwt.encode({'iss': ISSUER, 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                      open(KEY_PATH).read(), algorithm='ES256', headers={'kid': KEY_ID})


def req(method, path, **kw):
    # App Store Connect returns sporadic 500s on screenshot reservations; retry those.
    for attempt in range(5):
        r = requests.request(method, path if path.startswith('http') else BASE + path,
                             headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'}, **kw)
        if r.status_code < 500:
            break
        time.sleep(5 * (attempt + 1))
    if r.status_code >= 300:
        sys.exit(f'{method} {path} -> {r.status_code}: {r.text[:600]}')
    return r.json() if r.text else {}


def version_locs(version_id):
    return {l['attributes']['locale']: l for l in req('GET', f'/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations?limit=50')['data']}


def editable_app_info(version_id):
    app_id = req('GET', f'/v1/appStoreVersions/{version_id}?include=app')['data']['relationships']['app']['data']['id']
    infos = req('GET', f'/v1/apps/{app_id}/appInfos')['data']
    live = {'READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'}
    return next((i for i in infos if i['attributes'].get('appStoreState') not in live), infos[0])['id']


def cmd_apps():
    for a in req('GET', '/v1/apps?limit=50')['data']:
        at = a['attributes']
        print(f"{a['id']}  {at['bundleId']}  {at['name']}  primary={at['primaryLocale']}")
        for v in req('GET', f"/v1/apps/{a['id']}/appStoreVersions?limit=4")['data']:
            va = v['attributes']
            print(f"    {va['platform']:8} {va['versionString']:10} {va['appStoreState']:24} {v['id']}")


def cmd_locales(version_id):
    info = editable_app_info(version_id)
    names = {l['attributes']['locale']: l['attributes'] for l in req('GET', f'/v1/appInfos/{info}/appInfoLocalizations?limit=50')['data']}
    for loc, l in sorted(version_locs(version_id).items()):
        a, n = l['attributes'], names.get(loc, {})
        print(f"{loc:8} name={n.get('name')!r} subtitle={n.get('subtitle')!r} keywords={len((a.get('keywords') or '').encode())}B "
              f"desc={len(a.get('description') or '')} promo={len(a.get('promotionalText') or '')} whatsNew={len(a.get('whatsNew') or '')}")


def cmd_set(version_id, locale, field, path):
    value = open(path, encoding='utf-8').read().rstrip('\n')
    if field in ('name', 'subtitle'):
        info = editable_app_info(version_id)
        loc = {l['attributes']['locale']: l for l in req('GET', f'/v1/appInfos/{info}/appInfoLocalizations?limit=50')['data']}[locale]
        req('PATCH', f"/v1/appInfoLocalizations/{loc['id']}", json={'data': {'type': 'appInfoLocalizations', 'id': loc['id'], 'attributes': {field: value}}})
        got = req('GET', f"/v1/appInfoLocalizations/{loc['id']}")['data']['attributes'][field]
    else:
        locs = version_locs(version_id)
        if locale not in locs:
            # Creating the version localization also creates the app-info one; PATCH that afterwards.
            new = req('POST', '/v1/appStoreVersionLocalizations', json={'data': {'type': 'appStoreVersionLocalizations', 'attributes': {'locale': locale, field: value},
                      'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': version_id}}}}})['data']
            got = new['attributes'][field]
        else:
            lid = locs[locale]['id']
            req('PATCH', f'/v1/appStoreVersionLocalizations/{lid}', json={'data': {'type': 'appStoreVersionLocalizations', 'id': lid, 'attributes': {field: value}}})
            got = req('GET', f'/v1/appStoreVersionLocalizations/{lid}')['data']['attributes'][field]
    print('ok' if got == value else f'MISMATCH: stored {got!r}')


def cmd_clear(version_id, field):
    for loc, l in version_locs(version_id).items():
        req('PATCH', f"/v1/appStoreVersionLocalizations/{l['id']}", json={'data': {'type': 'appStoreVersionLocalizations', 'id': l['id'], 'attributes': {field: None}}})
        print(loc, 'cleared')


def cmd_screenshots(version_id, locale, display_type, folder):
    loc = version_locs(version_id)[locale]['id']
    sets = {s['attributes']['screenshotDisplayType']: s['id'] for s in req('GET', f'/v1/appStoreVersionLocalizations/{loc}/appScreenshotSets')['data']}
    sid = sets.get(display_type) or req('POST', '/v1/appScreenshotSets', json={'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': display_type},
        'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': loc}}}}})['data']['id']
    for old in req('GET', f'/v1/appScreenshotSets/{sid}/appScreenshots')['data']:
        req('DELETE', f"/v1/appScreenshots/{old['id']}")
    ids = []
    for path in sorted(glob.glob(os.path.join(folder, '*.png'))):
        data = open(path, 'rb').read()
        shot = req('POST', '/v1/appScreenshots', json={'data': {'type': 'appScreenshots', 'attributes': {'fileName': os.path.basename(path), 'fileSize': len(data)},
                   'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': sid}}}}})['data']
        for op in shot['attributes']['uploadOperations']:
            requests.request(op['method'], op['url'], headers={h['name']: h['value'] for h in op['requestHeaders']},
                             data=data[op['offset']:op['offset'] + op['length']]).raise_for_status()
        req('PATCH', f"/v1/appScreenshots/{shot['id']}", json={'data': {'type': 'appScreenshots', 'id': shot['id'],
            'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
        ids.append(shot['id'])
    req('PATCH', f'/v1/appScreenshotSets/{sid}/relationships/appScreenshots', json={'data': [{'type': 'appScreenshots', 'id': i} for i in ids]})
    for _ in range(12):
        states = [x['attributes']['assetDeliveryState']['state'] for x in req('GET', f'/v1/appScreenshotSets/{sid}/appScreenshots')['data']]
        if all(s == 'COMPLETE' for s in states):
            break
        time.sleep(5)
    print(f'{len(ids)} uploaded:', states)


if __name__ == '__main__':
    commands = {'apps': cmd_apps, 'locales': cmd_locales, 'set': cmd_set, 'clear': cmd_clear, 'screenshots': cmd_screenshots}
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        sys.exit(__doc__)
    commands[sys.argv[1]](*sys.argv[2:])
