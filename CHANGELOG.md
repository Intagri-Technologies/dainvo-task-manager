# Changelog

## Unreleased

### Changed

- Changes from Dainvo mobile are written before the vault is published, and
  the vault is published once after them. The last edit wins: a phone change
  is written unless the vault changed the same task's status after the phone
  did (the note's modified time is the vault's edit time). No change is
  reported back as a conflict.
- Writes from Dainvo change only the checkbox, the completion date and the
  fields Dainvo changed. Tags (including Unicode tags such as `#café`),
  Dataview dates (`[due:: ]`, `[completion:: ]`), metadata order and the
  status character stay as they are.
- Completing a `🔁` task uses the Tasks plugin (7.2.0 or later) when it is
  installed, so the next occurrence follows your Tasks settings. Without
  Tasks, the task is completed in place.
- `[/]` (in progress) is read as open and `[-]` (cancelled) as done; any
  other single status character is a task too.
- Deleting a task from Dainvo also removes its subtasks and indented notes.
- Vaults paired only with Dainvo desktop also get stable task markers.
- The local bridge sends the vault as it is on every attempt; a retry never
  resends an older inventory.

### Fixed

- `✅` dates use your local day instead of the UTC day.
- A failed desktop write no longer leaves an entry that made every retry look
  like an uncertain earlier write.

## 1.6.0 - Unreleased

Requires the Dainvo backend with the Obsidian publisher fence
(`20260928000700_obsidian_pending_operation_publisher_fence.sql`). Release it
together with, or after, the Dainvo desktop that carries publication v2.

### Changed

- Mobile sync publishes ordered, replay-safe publications (publication v2).
  Each publication carries the backend-issued publisher epoch and a sequence,
  bounded publications resume after an interruption, and tasks with pending
  mobile changes stay published outside the normal window.
- Reading and acknowledging mobile changes now sends this installation's device
  ID and publisher epoch. After another installation takes over the vault, this
  one can no longer read or acknowledge its changes.

### Fixed

- A mobile change acknowledged while another installation took over the vault
  is kept in the local journal and retried once straight away; the retry
  either resumes with the current epoch or pauses because another vault
  publisher is selected.
- A publication the server rejects as stale is dropped, and the next sync
  adopts the server sequence and republishes in full.
- Every request in a sync runs as the account checked at its start; signing in
  to another Dainvo account mid-sync pauses instead of publishing into it.
  Relinking binds to the new account at once, and disabling purges only as the
  vault's owner.
- Journal Obsidian task writes, persist write receipts, and recover lost
  acknowledgements and interrupted moves.
- Stale OAuth callbacks and token refreshes can no longer restore a signed-out
  session.

## 1.5.0 - 2026-09-09

### Added

- **Open task in Dainvo**: a command and an editor context-menu item on
  checkbox lines that open the task in the paired Dainvo desktop app through a
  `dainvo://obsidian/task/<vault>/<block id>` link. A line without a stable
  `^d-` ID receives one first, and a snapshot is pushed so the desktop keeps
  the task's identity instead of importing a duplicate.
- **Open project in Dainvo**: a file-menu item on notes inside the Project
  Notes folder that asks the paired desktop which Project owns the note and
  opens it. Requires a Dainvo desktop that advertises `project_note_links_v1`.
- Remember the paired desktop's deep-link scheme so development builds of
  Dainvo (`dainvo-dev://`) receive their own links.

## 1.4.0 - 2026-08-19

### Added

- Advertise `cross_note_hierarchy_move_v1` to paired Dainvo desktop apps.
- Move a stable leaf task and its contiguous indented non-task Markdown between
  notes after Dainvo's destructive-action confirmation.

### Fixed

- Preserve an existing desktop pairing while migrating legacy bridge tokens to
  Obsidian SecretStorage during plugin upgrades. Vaults already showing **Not
  paired** must be paired once more because an erased token cannot be recovered
  safely.
- Preserve blank checkbox nodes and their indentation hierarchy in desktop
  bridge snapshots while continuing to exclude them from mobile publication.
- Make cross-note retries destination-first and idempotent, with safe
  compensation when source deletion fails.
- Preserve CRLF and final-newline style during hierarchy moves.

## 1.3.0 - 2026-08-19

### Added

- Add a desktop-only Project Notes folder setting with vault-folder suggestions
  and cross-platform-safe relative-path validation.
- Export the selected Project Notes folder to a locally paired Dainvo desktop
  app through the existing snapshot and pairing payloads.

### Privacy

- Keep Project Notes configuration, files, and Markdown content out of Dainvo
  mobile cloud task publication.

## 1.2.1 - 2026-08-17

### Fixed

- Add searchable declarative settings for Obsidian 1.13 while preserving the
  existing settings interface on Obsidian 1.11.4 and later.
- Make release builds reproducible from a clean checkout by versioning only
  the public Dainvo cloud client configuration used by official builds.

### Security

- Reject secret or service-role Supabase keys in the public plugin runtime.
- Document vault reads, external network destinations, and OAuth base64url
  processing used by the plugin.

## 1.2.0 - 2026-08-14

### Added

- Export vault-owned item-note placement, folder hierarchy, filename-time, and
  initial-content settings to paired Dainvo desktop installations through the
  backward-compatible snapshot-v2 `itemNoteSettings` field and
  `item_notes_v1` bridge capability.
- Publish snapshot schema v2 hierarchy metadata derived from Markdown
  indentation, including parent provider identity and stable sibling order.
- Share the schema-v2 parser fixture with Dainvo desktop so tabs, spaces, nested
  tasks, and sibling order remain contract-tested across both projects.

### Compatibility

- Continue accepting schema-v1 root-only snapshots. A v1 retry does not clear
  hierarchy previously published by a v2 client.

## 1.1.5 - 2026-07-21

### Fixed

- Use a shorter, directory-compliant plugin description.

## 1.1.4 - 2026-07-20

### Fixed

- Wait to add a stable task ID until the caret leaves the task line, preventing
  Enter from moving the marker onto a blank continued checkbox.
- Repair Dainvo-owned markers stranded on otherwise blank checkbox lines.
- Use Obsidian's active window and configured vault directory for popout and
  custom configuration-directory compatibility.

### Changed

- Use compact nine-character stable task markers such as `^d-A7k2Pq` for new
  tasks.
- Hide Dainvo stable task markers on inactive task lines in Live Preview;
  reveal them on the active line and keep Source mode unchanged.
- Preserve existing UUID-length `^dainvo-...` markers without rewriting task
  identity.
- Run the official Obsidian plugin lint rules in CI and release validation.
