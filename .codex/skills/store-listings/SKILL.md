---
name: store-listings
description: Update Dainvo's App Store (iOS and Mac), Microsoft Store and Google Play listings, including text, keywords, localizations and screenshots. Use when entering or checking store metadata, uploading store screenshots, or preparing a version's listing.
---

# Store listings

Dainvo's store listings are changed through App Store Connect (API), Microsoft
Partner Center (browser) and Google Play Console (browser). Listing copy,
screenshots and plans live in the workspace; the stores hold drafts until the
owner submits.

## Hard rules

- Never submit a version or listing for review, publish, or press Play's
  **Save** on the main listing (managed publishing is off, so Save publishes)
  without the owner's explicit OK for that action.
- Leave **What's New** empty on every store until the owner says the release
  is ready. When asked, write it for users about that version's new features,
  not as a bug-fix list.
- Claims must match the build that store ships. The Mac App Store and
  Microsoft Store builds have no built-in ChatGPT/Claude chat (only external
  ChatGPT, Codex and Claude connections). Check the current feature inventory
  (`docs/research/DESKTOP_FEATURE_INVENTORY_*.md`) before adding a claim.
- Apple metadata: no other mobile platform names (guideline 2.3.10, so no
  "Android" on iOS or Mac), and no other companies' names in name, subtitle or
  keywords (2.3.7). The description may name integrations.
- Microsoft: the title stays "Dainvo" (policy 10.1.1); search terms can't name
  other products (10.1.3); the description has no URLs.
- Never print or commit the App Store Connect `.p8` key or a JWT.

## Where things are

| Item | Location |
| --- | --- |
| iOS app | `com.dainvo.dainvoios`, id 6784490855, primary locale en-CA |
| Mac app | `com.dainvo.calendar`, id 6772297968, primary locale en-US |
| Microsoft Store | Store ID XP8JHLNFHZGW6T, MSI app, Partner Center app 978580b6-919d-41dd-8254-b108a25a72d3 |
| Product facts and claim rules | `marketing/Product Copy/dainvo-product-copy.md`, the single source; store copy follows it |
| Listings | `marketing/Store Listings/<store>/` for `iOS App Store`, `Google Play`, `Mac App Store`, `Microsoft Store`, `Snap Store`: English `listing-en*.md`, `translations/<code>.json`, and `images/` (what gets uploaded; the Microsoft `images/` folder is also the Import-listing folder with its CSV) |
| Copy kept elsewhere | The mobile release skill updates the version rows in the iOS and Play `listing-en.md`; iOS and Play submission checklists stay in `dainvo_mobile/marketing/`; Snap text is package metadata in `dainvo/snap/snapcraft.yaml` |
| Plans and reasoning | workspace `docs/MOBILE_STORE_*`, `docs/DESKTOP_STORE_LISTING_SEO_PLAN_*` |
| App captures | `marketing/Screenshots/{iPhone,iPad,Android,Desktop}` (README lists every file); retired sets in `marketing/Archive/` |
| Index | `marketing/README.md` and `marketing/Store Listings/README.md` |
| Tools | `marketing/Store Listings/tools/`: `compose_mac.mjs` and `compose_phone.mjs` (Playwright, then `flatten_rgb.py`) build the store slides, the `compose_*.py` scripts (Pillow) the poster and feature graphic; `fill_microsoft_csv.py` fills the Microsoft Import-listing CSV from the translations |

## App Store Connect (iOS and Mac)

Use [`scripts/asc.py`](scripts/asc.py). It signs requests with the owner's
App Manager key; the defaults in the script point at the key file on this Mac
(`~/Documents/Keys/Dainvo/`). Needs `pip install pyjwt cryptography requests`.

```bash
python skills/store-listings/scripts/asc.py apps                       # apps, versions, version ids
python skills/store-listings/scripts/asc.py locales VERSION_ID         # fields and lengths per locale
python skills/store-listings/scripts/asc.py set VERSION_ID en-US description desc.txt
python skills/store-listings/scripts/asc.py screenshots VERSION_ID en-US APP_DESKTOP "marketing/Store Listings/Mac App Store/images"
```

`set` reads the value back and prints `ok` or the mismatch.

Gotchas:

- Only **promotional text** can change on a live version. Everything else needs
  a version in `PREPARE_FOR_SUBMISSION`. If none exists, ask the owner before
  creating one (`POST /v1/appStoreVersions`); a new version copies the live
  version's text and screenshots.
- Creating a version localization also creates the app-info localization
  (name, subtitle). PATCH it afterwards; a POST returns 409. `asc.py set`
  handles this.
- **Names must be unique across apps in the same locale.** The Mac and iPhone
  apps need different names in each language (the iPhone app already uses
  "Dainvo: Calendar & To-Do List" and its translations).
- Keywords: 100 UTF-8 bytes, commas without spaces, no word already in the name
  or subtitle. CJK characters are 3 bytes each.
- Screenshot types and sizes: `APP_IPHONE_67` 1320 × 2868, `APP_IPAD_PRO_3GEN_129`
  2064 × 2752, `APP_DESKTOP` 2880 × 1800 (16:10). PNG, RGB, no alpha, 1–10 per set.
  Locales without their own screenshots show the primary locale's.
- The screenshot reservation call returns sporadic 500s; `asc.py` retries.
- Apple Ads keyword popularity covers iPhone and iPad only, not the Mac.

## Microsoft Partner Center

No API is set up; use the browser pane. The owner signs in; never enter a password.

- Text fields fill reliably from JavaScript: set the value with the native
  setter, then dispatch `input`, `change` and `blur`, and check the character
  counters changed before **Save draft**.
- A listing language won't save until it has at least one screenshot and the
  1:1 box art. The agent can't pick local files, so the owner drags images in:
  8 screenshots, box art `dainvo/assets/logo.png` (1080 × 1080) and the 2:3
  poster. For many languages, use **Export listing** / **Import listing**
  instead: the exported CSV plus the images in one folder that the owner
  selects once.
- Drag-to-reorder screenshots needs native drag events; ask the owner to do it.
- The package **Languages** (Packages page, each architecture) must be the app's
  13 languages: English, French, Spanish, Portuguese (Brazil), German, Dutch,
  Norwegian (Bokmål), Finnish, Swedish, Kiswahili, Korean, Japanese, Chinese
  (Simplified). Click **Save all** after editing packages.
- MSI listings have no screenshot captions.
- Limits: description 10,000; short description (first 270 shown); 20 features
  × 200; 7 search terms × 40 characters, 21 words total.

## Google Play Console

Listings are browser only. Screenshots are uploaded by the owner (the browser
pane can't attach files). Text drafts can be filled; the main listing's
**Save** submits it for review, so stop before Save unless the owner asked to
publish.

Prices can be read with [`scripts/play.py`](scripts/play.py) (read-only, GET
requests only). It signs in as the `dainvo-play-read` service account, whose
key is `~/Documents/Keys/Dainvo/play-read.json` and which has only **View app
information (read-only)** on the app. Needs
`python3 -m pip install --user google-auth requests` once.

```bash
python3 skills/store-listings/scripts/play.py prices US CA GB
```

Play and App Store prices are set separately and can differ (30 Sep 2026: Play
US $4.99 / $47.99, App Store US $5.00 / $48.00).

## Done when

Every changed field is read back from the store and matches the source copy,
screenshots report as processed, and the listing READMEs or copy files note what
was entered and what is still pending for the owner.
