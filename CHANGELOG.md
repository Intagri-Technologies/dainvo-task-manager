# Changelog

## Unreleased

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
