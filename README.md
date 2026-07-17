# Dainvo Task Manager

Dainvo Task Manager connects Obsidian checkbox tasks to Dainvo. Version 1.1.2
supports Obsidian desktop and mobile and can publish task projections directly
to Dainvo mobile without requiring Dainvo desktop.

Website: [dainvo.com](https://dainvo.com)

## What you can do

- Keep writing Markdown checkbox tasks naturally in Obsidian.
- View synced tasks in Dainvo mobile while offline.
- Complete or reopen a task in Dainvo mobile and apply the checkbox change the
  next time the selected vault publisher is active.
- Sync task title, completion, priority, tags, date-only due information, and
  relative source-note metadata.
- Keep the existing localhost Dainvo desktop pairing for planning, Daily Notes,
  and the broader desktop editing workflow.

Dainvo mobile can also request a confirmed delete when this plugin is the
selected publisher. The plugin verifies the stable task identity and source
line, removes only the complete Markdown task line, then republishes the vault
snapshot before acknowledging the operation. Create, rename, and move remain in
Obsidian or Dainvo desktop.

## Direct mobile task sync

1. Open Obsidian Settings > Dainvo Task Manager.
2. Under **Dainvo mobile task sync**, choose **Sign in** and finish browser
   authorization with the same Dainvo account used on your phone.
3. Select an existing cloud vault mapping or create one for this vault.
4. Choose a stable-ID mode. **Backfill existing + future tasks** is the default;
   **New tasks only** leaves existing ID-less tasks unchanged.
5. Enable sync and wait for **Published**.

Only one installation publishes a cloud vault at a time. A newly connected
installation does not take ownership automatically. If another Obsidian
installation or Dainvo desktop is selected, sync pauses until you intentionally
choose **Use this device**.

The publisher sends at most 300 active nonblank tasks and the 700 most recently
completed nonblank tasks. It advertises complete/reopen/delete support and
checks for queued mobile operations
every 30 seconds while Obsidian is active. Obsidian desktop continues while open
or minimized. Obsidian mobile runs while foregrounded and on resume; the mobile
operating system may suspend Obsidian after it is closed.

Offline changes are eventual. Dainvo mobile keeps a local task cache and durable
operation queue. The phone must reconnect to upload a change, and the selected
vault publisher must later run to update the real Markdown checkbox.

## Stable task IDs

The plugin uses an existing unique Obsidian block ID when one is present.
Otherwise it appends an ID such as `^dainvo-550e8400-e29b-41d4-a716-446655440000`
with Obsidian's atomic vault API. Stable IDs keep a task's cloud identity when a
line moves within a note or between notes.

- **Backfill existing + future tasks** shows the number of affected tasks and
  asks for confirmation before changing files. The migration is journaled and
  resumes safely after a restart.
- **New tasks only** records the current ID-less tasks as a baseline and assigns
  IDs only to tasks created afterward. A publisher takeover establishes a fresh
  baseline before watching for new tasks.

The parser does not add IDs in frontmatter, fenced code, non-task examples,
blank-title tasks, or unsupported lines. Immediately before each atomic edit,
the plugin re-parses the complete current note so a task moved into an excluded
region after the initial scan is not changed. If a Dainvo ID was copied, the
first occurrence keeps it and later occurrences receive new IDs during repair.
Existing IDs are never removed when the mode changes.

## Optional Dainvo desktop pairing

The localhost bridge remains available on Obsidian desktop and is independent
from direct mobile task sync:

1. Open Dainvo desktop and start an Obsidian pairing session.
2. In Obsidian Settings > Dainvo Task Manager, paste the bridge URL and pairing
   code.
3. Choose **Pair with Dainvo**.

Bridge and Daily Notes settings are hidden on Obsidian mobile. If a paired older
Dainvo desktop cannot understand stable-ID aliases, the plugin blocks backfill
and asks you to update Dainvo desktop or disconnect that local bridge.

## Privacy and account safety

Direct sync is an explicit per-vault opt-in. The relay receives only task
projections and relative note metadata. It never receives Markdown bodies, raw
task lines, attachments, full filesystem paths, vault files, bridge secrets,
OAuth refresh tokens, or account passwords.

OAuth access and refresh tokens, pending PKCE state, the local bridge bearer
token, and the installation UUID are stored in Obsidian SecretStorage rather
than `data.json`. Every cloud mapping is scoped to the signed-in Dainvo user.
Signing out pauses work without silently deleting cloud data; switching accounts
requires an explicit relink. A revoked or expired refresh grant clears the cloud
session and pauses as signed out, while network and server failures retain the
session for retry.

Disabling sync stops publication immediately and requests deletion of the cloud
copy. If deletion cannot be confirmed, the plugin shows **Disable pending** and
keeps enough local mapping state to retry.

## Daily Notes

Dainvo Task Manager uses Obsidian Daily Notes and Periodic Notes settings when
available. Daily Notes integration is part of the optional local desktop bridge;
it is separate from the direct task relay and does not upload note bodies.
