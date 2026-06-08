# Dainvo Task Manager

Dainvo Task Manager is a desktop-only Obsidian plugin for syncing Markdown tasks from one or more vaults into Dainvo.

## Features

- Indexes standard Markdown checkbox tasks and Obsidian Tasks-compatible emoji metadata.
- Pushes debounced vault snapshots to Dainvo's localhost bridge while Obsidian is open.
- Exports vault path and Daily Notes settings so Dainvo can keep syncing while Obsidian is closed.
- Applies Dainvo write-back operations with `Vault.process()` when Obsidian is open.
- Supports write-back for existing task title, completion state, deletion, tags, due date, and priority.
- Preserves unsupported task metadata, including recurrence text.

## Requirements

- Obsidian desktop.
- Dainvo desktop app installed on the same computer.
- A paired Dainvo account for each vault you want to sync.

This plugin is desktop-only because Dainvo uses local vault paths and a localhost bridge.

## Pairing

1. In Dainvo, start an Obsidian pairing session.
2. In Obsidian, open Settings -> Dainvo Task Manager.
3. Paste the Dainvo bridge URL and pairing code.
4. Select Pair with Dainvo.

The plugin stores a bearer token in Obsidian plugin data for the current vault. Dainvo stores the vault path and can rescan Markdown directly while Obsidian is closed.

## Privacy And Local Data

- The plugin communicates with Dainvo on `127.0.0.1` using the bridge URL and token from pairing.
- The plugin does not send vault content to Intagri Technologies servers.
- Synced task data is sent only to the locally running Dainvo desktop app.
- Removing the pairing in plugin settings clears the stored Dainvo bridge details for that vault.

## Daily Notes

The plugin detects Obsidian Daily Notes and Periodic Notes daily settings when available and sends those settings to Dainvo. Dainvo can use those settings to create or edit daily notes directly from the local vault files.

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

## Release

The GitHub release tag must match `manifest.json` exactly. For example, version `1.0.0` should use tag `1.0.0`.

The release workflow uploads the files Obsidian expects:

- `main.js`
- `manifest.json`
- `styles.css`
- `dainvo-task-manager.zip`
