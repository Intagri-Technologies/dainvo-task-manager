# Dainvo Task Manager

Desktop-only Obsidian community plugin for syncing Markdown tasks from one or more Obsidian vaults into Dainvo.

## V1 Scope

- Indexes standard Markdown checkbox tasks and Obsidian Tasks-compatible emoji metadata.
- Pushes full debounced vault snapshots to Dainvo's localhost bridge.
- Pulls pending Dainvo write-back operations and applies them with `Vault.process()`.
- Supports write-back for existing task title, completion state, deletion, tags, due date, and priority.
- Does not create new Obsidian tasks from Dainvo.
- Does not implement Daily Notes task creation or recurring task expansion.

## Pairing

1. In Dainvo, start an Obsidian pairing session.
2. In Obsidian, open Settings -> Dainvo Task Manager.
3. Paste the Dainvo bridge URL and pairing code.
4. Select Pair with Dainvo.

The plugin stores a bearer token in Obsidian plugin data for this vault. Dainvo stores the vault path and can rescan Markdown directly while Obsidian is closed.

## Development

```bash
pnpm install
pnpm test
pnpm build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/dainvo-task-manager/
```

## Community Release Status

This repo is structured for Obsidian community plugin release, but it should not be submitted to the community directory until local pairing, two-vault sync, offline disk scan, and write-back conflict behavior are manually verified.

