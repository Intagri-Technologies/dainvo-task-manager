#!/usr/bin/env python3
"""Google Play helper for Dainvo's Android app. Read-only: GET requests only.

Needs: pip install google-auth requests
Credentials: the dainvo-play-read service account key (never commit it):
  PLAY_KEY_PATH  ~/Documents/Keys/Dainvo/play-read.json
That account has only "View app information (read-only)" on the app in
Play Console, which is enough to read subscription prices.

Commands:
  prices [REGION ...]   Pro base plan prices, e.g. `prices US CA GB`
                        (no regions: every region)
"""
import os, sys

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

KEY_PATH = os.path.expanduser(os.environ.get('PLAY_KEY_PATH', '~/Documents/Keys/Dainvo/play-read.json'))
PACKAGE = 'com.dainvo.dainvo_android'
SUBSCRIPTION = 'com.dainvo.android.pro'
BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3'


def get(path):
    creds = service_account.Credentials.from_service_account_file(
        KEY_PATH, scopes=['https://www.googleapis.com/auth/androidpublisher'])
    creds.refresh(Request())
    r = requests.get(BASE + path, headers={'Authorization': 'Bearer ' + creds.token})
    if r.status_code >= 300:
        sys.exit(f'GET {path} -> {r.status_code}: {r.text[:400]}')
    return r.json()


def money(price):
    return f"{price.get('currencyCode')} {int(price.get('units', 0)) + price.get('nanos', 0) / 1e9:.2f}"


def cmd_prices(*regions):
    sub = get(f'/applications/{PACKAGE}/subscriptions/{SUBSCRIPTION}')
    wanted = {r.upper() for r in regions}
    for plan in sub.get('basePlans', []):
        print(plan.get('basePlanId'), plan.get('state'))
        for config in plan.get('regionalConfigs', []):
            if not wanted or config.get('regionCode') in wanted:
                print(f"  {config.get('regionCode')}  {money(config.get('price', {}))}")


if __name__ == '__main__':
    commands = {'prices': cmd_prices}
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        sys.exit(__doc__)
    commands[sys.argv[1]](*sys.argv[2:])
