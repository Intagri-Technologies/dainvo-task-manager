# Dainvo Task Manager

Bring your Obsidian checkbox tasks into Dainvo without changing how you write
notes. Keep using normal Markdown tasks in Obsidian, then view and update them
from Dainvo mobile or Dainvo desktop.

Dainvo Task Manager works with Obsidian on desktop and mobile. Dainvo desktop
is optional.

[Visit dainvo.com](https://dainvo.com)

## What it does

- Syncs normal Obsidian checkbox tasks with Dainvo.
- Keeps tasks available in Dainvo mobile while offline.
- Lets you complete or reopen tasks from Dainvo.
- Syncs priorities, tags, due dates, and source-note information.
- Supports optional Dainvo desktop planning and Daily Notes features.

## Set up mobile sync

1. Open **Obsidian Settings > Dainvo Task Manager**.
2. Select **Sign in** under **Dainvo mobile task sync**.
3. Use the same Dainvo account that is signed in on your phone.
4. Keep the recommended **Backfill existing + future** option.
5. Select **Enable** and wait for **Published**.

One Obsidian vault can be connected to Dainvo mobile at a time. You can switch
vaults from the plugin settings without deleting or changing the notes in the
previous vault.

Obsidian needs to be running to send new changes and apply updates from Dainvo.
Changes made offline will sync after your devices reconnect.

## About task markers

Dainvo adds a short marker such as `^d-A7k2Pq` so it can recognize a task after
you move it. The marker is hidden on inactive task lines in Live Preview and is
shown while you edit the line. Existing Obsidian block IDs are respected.

## Privacy

Dainvo syncs task details, not your full notes. The plugin does not upload note
bodies, attachments, full filesystem paths, account passwords, or local bridge
secrets. Sign-in information is kept in Obsidian's secure storage.

Disabling sync stops future updates and lets you delete the synced cloud copy.
Your Obsidian notes remain unchanged.

## Optional Dainvo desktop features

Pairing with Dainvo desktop adds local planning and Daily Notes features. Start
an Obsidian pairing session in Dainvo desktop, then enter the displayed bridge
URL and pairing code in the plugin settings.

## Help

If tasks are not appearing, confirm that Obsidian is open and the plugin status
is **Published**. For release details, see the [changelog](CHANGELOG.md). To
report a problem, open a
[GitHub issue](https://github.com/Intagri-Technologies/dainvo-task-manager/issues).
