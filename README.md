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
- Lets you confirm a relayed-task deletion in Dainvo mobile; the selected
  plugin publisher applies the queued deletion to Markdown.
- Syncs priorities, tags, due dates, and source-note information.
- Supports optional Dainvo desktop planning, Daily Notes, and local item-note
  features.

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

## Nested Markdown tasks

Snapshot schema v2 preserves normal Markdown task indentation as hierarchy
metadata for Dainvo. The nearest preceding task at a lower indentation
level becomes the parent, and tasks at the same indentation receive stable
zero-based sibling order. Tabs advance to four-column stops so the plugin and
Dainvo desktop interpret mixed tabs and spaces identically.

The published task record adds only `parent_provider_task_id`, `sibling_order`,
and `indent_columns`. It still does not upload the surrounding note body. Older
schema-v1 snapshots remain compatible and are treated as root-only. If a v1
publisher retries after a v2 snapshot, the cloud relay preserves the existing
v2 relationship instead of flattening it.

Dainvo can display these nested tasks and their direct progress. In a paired
desktop vault, Dainvo can also drag a leaf task beneath another open task in
the same note, or move that child back to the top level. The plugin applies the
move to the Markdown list and republishes the authoritative snapshot. Tasks
that already own subtasks and cross-note moves remain editable in Obsidian.

## Privacy

Dainvo syncs task details, not your full notes. The plugin does not upload note
bodies, attachments, full filesystem paths, account passwords, or local bridge
secrets. Sign-in information is kept in Obsidian's secure storage.

Item-note Markdown bodies and desktop link mappings stay local. Checkbox tasks
written inside an item note are still ordinary vault tasks, so they remain part
of the existing task snapshot and optional Dainvo mobile task relay.

Disabling sync stops future updates and lets you delete the synced cloud copy.
Your Obsidian notes remain unchanged.

## Optional Dainvo desktop features

Pairing with Dainvo desktop adds local planning, Daily Notes, and item-note
features. Start an Obsidian pairing session in Dainvo desktop, then enter the
displayed bridge URL and pairing code in the plugin settings.

The **Dainvo item notes** plugin settings control whether event, video-meeting,
and bucket notes are placed beside Daily Notes or in a dedicated vault folder.
Dedicated placement can add year, month, and optional day directories. You can
also include timed-item start times in filenames and choose whether new files
start blank or with the saved item title as an H1. Dainvo desktop only displays
this exported configuration; the plugin remains its source of truth.

Item notes use separate Markdown files. Disabling the feature, disconnecting a
vault, or changing placement never deletes existing files.

## Help

If tasks are not appearing, confirm that Obsidian is open and the plugin status
is **Published**. For release details, see the [changelog](CHANGELOG.md). To
report a problem, open a
[GitHub issue](https://github.com/Intagri-Technologies/dainvo-task-manager/issues).
