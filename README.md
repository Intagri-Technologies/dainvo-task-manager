# Dainvo Task Manager

## Project notes

On Obsidian desktop, **Settings → Dainvo Task Manager → Notes → Project notes**
selects the vault-relative Projects directory used by a locally paired Dainvo
desktop app. The folder defaults to `Projects` and is created lazily when the
first Project note is added. Project note files and Markdown content stay in
the vault and are not included in Dainvo mobile task sync.

After updating the plugin, confirm that **Desktop pairing** still shows
**Connected**. If an older installation shows **Not connected**, pair that
vault once more; the next snapshot immediately sends the selected Projects
folder to Dainvo desktop without changing any note files.

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
2. Select **Sign in** beside **Dainvo account** at the top of the page.
3. Use the same Dainvo account that is signed in on your phone.
4. Keep **General > Task markers** set to **Existing and new tasks (recommended)**.
5. Select **Enable** beside **Mobile sync** and wait for **Up to date**.

The main settings page keeps your account, desktop pairing and mobile sync
together, with each status beside its controls. **Desktop pairing > Options**
opens the bridge URL, pairing code and disconnect controls. **Mobile sync >
Options** opens sync help, recovery actions and **Disable and delete**.
**Notes** groups Daily Notes, event/meeting/bucket notes and project-note folders
into separate pages. Desktop pairing and note options appear only on desktop.

One Obsidian vault can be connected to Dainvo mobile at a time. You can switch
vaults from the plugin settings without deleting or changing the notes in the
previous vault.

Obsidian needs to be running to send new changes and apply updates from Dainvo.
Changes made offline will sync after your devices reconnect.

## Desktop task write recovery

New desktop task creates wait in Dainvo until a paired plugin advertising
`task_create_v1` can apply them. Update the plugin if Dainvo asks for this
capability. Keep Obsidian open to apply queued changes; closing it leaves the
changes pending in Dainvo.

The plugin edits existing notes through Obsidian's Vault API and saves a local
operation receipt before acknowledging each write. If the acknowledgement is
lost, it can acknowledge the saved receipt without repeating the edit. If the
plugin stops before saving the receipt, a task create is recovered only when
the exact task line and stable marker still exist. When the marker is absent,
that attempt reports a failure and clears its local entry, and Dainvo's retry
writes the task as a new create.

A task line edited in Obsidian after Dainvo read it is found again by its
marker, and only Dainvo's change is applied to the current line: the checkbox
and completion date, or the fields changed in Dainvo. Tags, Dataview fields and
other metadata stay untouched. Completing a recurring (`🔁`) task uses the
Tasks plugin 7.2.0 or later when it is installed, so the next occurrence
follows your Tasks settings. This journal stays in the vault's plugin
settings and is not uploaded to Dainvo mobile sync.

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
desktop vault, Dainvo can drag a leaf task beneath another open task. A move
between notes always requires a danger confirmation in Dainvo; the checkbox
and its contiguous indented non-task Markdown are added beneath the destination
parent and then removed from the original note. Moving a child back to the top
level keeps it in its current note. Nested checkbox subtasks still block a
move. Version 1.4.0 or later is required for cross-note moves.

Blank checkbox lines remain in the local desktop snapshot so named descendants
keep the correct hierarchy. They are still excluded from mobile publication.

## Privacy

Dainvo syncs task details, not your full notes. The plugin does not upload note
bodies, attachments, full filesystem paths, account passwords, or local bridge
secrets. Sign-in information is kept in Obsidian's secure storage.

Item-note Markdown bodies and desktop link mappings stay local. Checkbox tasks
written inside an item note are still ordinary vault tasks, so they remain part
of the existing task snapshot and optional Dainvo mobile task relay.

Disabling sync stops future updates and lets you delete the synced cloud copy.
Your Obsidian notes remain unchanged.

## Access and network disclosure

To discover checkbox tasks and publish an authoritative snapshot, the plugin
enumerates every Markdown file visible through Obsidian's Vault API and reads
its cached Markdown content. It does not enumerate attachments or use
unrestricted filesystem APIs. Stable-ID backfill and queued mobile operations
can update the specific task lines involved after confirmation or opt-in.

When mobile sync is enabled, Dainvo receives task identity, title, status,
priority, tags, due and completion dates, hierarchy, vault-relative note path,
note title, heading, and an Obsidian open URI. Dainvo does not receive complete
Markdown bodies, raw task lines, attachments, passwords, local bridge secrets,
or absolute filesystem paths.

The plugin can contact these destinations:

- `https://unrdknixyufoqvezjwko.supabase.co` for Dainvo authentication and the
  authenticated task relay.
- `https://users.dainvo.com/auth/obsidian-callback` to return from browser
  sign-in to Obsidian.
- `https://dainvo.com/pricing` only when you select **View plans**.
- The user-configured Dainvo desktop bridge, normally
  `http://127.0.0.1:58234` through `http://127.0.0.1:58238`.

Runtime base64url encoding creates OAuth PKCE values, and decoding reads the
account ID and display email from the signed-in user's JWT. It is not used to
hide executable code or encode vault content. The plugin contains no telemetry,
remote-code execution, or private Supabase/service-role key.

## Optional Dainvo desktop features

Pairing with Dainvo desktop adds local planning, Daily Notes, and item-note
features. Start an Obsidian pairing session in Dainvo desktop, then enter the
displayed bridge URL and pairing code in the plugin settings.

Dainvo desktop can also let its built-in AI providers read or propose changes
to Markdown in folders you select explicitly. Pairing a vault does not grant
that access: note reading and writing are separate, off-by-default permissions,
and full-vault access requires its own opt-in. Note content stays on the device
unless you separately use an external AI connection with its own consent.

The note tools do not edit Markdown checkbox tasks. If a selected note already
contains a checkbox task, or a proposed change would introduce one, Dainvo
rejects the note write and directs the action through its task tools and task
permissions instead. The desktop and plugin run the same syntax fixtures so
frontmatter and fenced-code examples are not mistaken for tasks.

The **Notes > Event, meeting and bucket notes** settings control whether event, video-meeting,
and bucket notes are placed beside Daily Notes or in a dedicated vault folder.
Dedicated placement can add year, month, and optional day directories. You can
also include timed-item start times in filenames and choose whether new files
start blank or with the saved item title as an H1. Dainvo desktop only displays
this exported configuration; the plugin remains its source of truth.

Item notes use separate Markdown files. Disabling the feature, disconnecting a
vault, or changing placement never deletes existing files.

**Open task in Dainvo** (command palette, or right-click a checkbox line)
opens that task in the paired Dainvo desktop app. If the line has no stable
`^d-` ID yet, the plugin adds one first and pushes a snapshot so the desktop
keeps the task's identity. **Open project in Dainvo** (right-click a note
inside the Project Notes folder) opens the Project that Dainvo created the
note for. Both need the local desktop pairing and open a `dainvo://` link the
operating system routes to Dainvo desktop.

## Help

If tasks are not appearing, confirm that Obsidian is open and the plugin status
is **Up to date**. For release details, see the [changelog](CHANGELOG.md). To
report a problem, open a
[GitHub issue](https://github.com/Intagri-Technologies/dainvo-task-manager/issues).

### Cloud sign-in lifecycle

Cloud sign-out clears the session and pending authorization before its
best-effort [local-scope logout](https://supabase.com/docs/guides/auth/signout)
request. Token responses check a persisted session revision, and callback state
is verified before handling errors. A late response cannot replace a newer
session or cancel a newer sign-in. Refresh calls from clients sharing the same
secret storage coalesce within the plugin runtime; retryable failures preserve
the stored session. Source Markdown and device bridge tokens are unchanged by
cloud sign-out. The protocol remains Supabase's documented
[authorization-code and refresh flow](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).


### Durable desktop write receipts

Desktop task writes advertise `write_receipt_v1`. The plugin saves the original
operation before changing a note, then saves the exact written task anchor
before acknowledging it. A lost acknowledgement is retried from that receipt;
it does not edit Markdown again. Desktop advances the anchor atomically while
preserving later local edits. Older plugins keep desktop writes queued with an
upgrade message.

Cross-note task moves journal the complete source block before inserting it
under the destination parent. After a restart, the plugin verifies the existing
destination block and removes only the unchanged original source block. A
changed source task is retained for review. Unrelated note edits survive. New
task creates continue to use stable saved block IDs, `Vault.process` for existing
notes and `Vault.create` for a missing note.

Desktop Settings → Integrations provides reviewed recovery for an uncertain
create or changed source. Linking or discarding a saved intent does not delete
remote notes. Creating another copy requires a duplicate warning and receives
a new operation and block identity. These changes require a coordinated desktop
and plugin release; mocked restart tests do not establish cross-process
filesystem compare-and-swap guarantees.

### Ordered publications and queued work

The local desktop bridge and cloud publisher retain publication identity until acknowledgement. A lost reply replays the same publication; stale publishers cannot replace newer content. Task identity aliases remain saved after delivery acknowledgements.

A deferred operation retains its retry deadline while independent targets continue. Cloud pending operations use a keyset cursor, so an old deferred task cannot occupy every batch. Source mutation still uses hash checks and `Vault.process`.

Cloud publications retain the ordinary 300 active/700 completed window and carry up to 100 additional queued targets or ancestors per publication. Acknowledged sequence numbers rotate those retained batches across restart. Coverage reports how many targets are selected and omitted; window omission is distinct from source deletion. Desktop and plugin use the same stable-identity ordering, with completion time ordering for completed tasks.

These clients require the additive pending-operation reader and retained-publication migrations before release. Older RPCs remain available for older clients.
