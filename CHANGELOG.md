# Changelog

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
