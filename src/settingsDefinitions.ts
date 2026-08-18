import {
  AbstractInputSuggest,
  Notice,
  Platform,
  TFolder,
  type ButtonComponent,
  type Setting,
  type SettingDefinitionGroup,
  type SettingDefinitionItem,
  type SettingDefinitionRender,
  type TextComponent,
} from "obsidian";

import type DainvoTaskManagerPlugin from "./main";
import type { StableIdMode } from "./types";

export type DainvoSettingsActions = {
  refresh: () => void;
  setStableIdMode: (mode: StableIdMode) => Promise<void>;
  enableCloudSync: () => Promise<void>;
  useThisDeviceAsPublisher: () => Promise<void>;
  disableCloudSync: () => Promise<void>;
};

type DainvoSettingRow = SettingDefinitionRender;

export function buildDainvoSettingDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionItem[] {
  return [
    buildCloudDefinitions(plugin, actions),
    buildDesktopBridgeDefinitions(plugin, actions),
    buildDailyNoteDefinitions(plugin, actions),
    buildItemNoteDefinitions(plugin, actions),
    buildProjectNoteDefinitions(plugin, actions),
  ];
}

function buildCloudDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "Dainvo mobile task sync",
    items: [
      infoRow(
        "About mobile task sync",
        "Sync task fields through Dainvo so they remain available offline in Dainvo mobile. Vault files, Markdown bodies, raw task lines, attachments, and full filesystem paths are never uploaded.",
      ),
      row("Mobile sync status", (setting) => {
        setting.setDesc(`Status: ${cloudStatusText(settings.cloudStatus)}`);
      }, { searchable: false }),
      row("Dainvo account status", (setting) => {
        const signedIn = plugin.isCloudSignedIn();
        setting.setDesc(
          signedIn
            ? `Signed in as ${plugin.cloudSignedInAccountLabel()}${settings.cloudPlanName ? ` · ${settings.cloudPlanName}` : " · checking plan…"}`
            : "Signed out",
        );
        if (signedIn) {
          void plugin
            .refreshCloudAccessStatus()
            .then((access) => {
              setting.setDesc(
                `Signed in as ${plugin.cloudSignedInAccountLabel()} · ${access.planName || "Unknown plan"} · ${access.allowed ? "mobile sync included" : "upgrade required"}`,
              );
            })
            .catch(() => {
              setting.setDesc(
                `Signed in as ${plugin.cloudSignedInAccountLabel()} · plan check unavailable`,
              );
            });
        }
      }, { aliases: ["sign in", "sign out", "account plan"] }),
      row("Dainvo account", (setting) => {
        const signedIn = plugin.isCloudSignedIn();
        setting
          .setName(signedIn ? "Dainvo account" : "Sign in to Dainvo")
          .setDesc(
            signedIn
              ? `Signed in as ${plugin.cloudSignedInAccountLabel()}. Signing out pauses this vault without deleting its cloud copy.`
              : "Opens the Dainvo account site and returns here through Obsidian after secure PKCE authorization.",
          )
          .addButton((button) =>
            button
              .setButtonText(signedIn ? "Sign out" : "Sign in")
              .onClick(async () => {
                try {
                  if (signedIn) {
                    await plugin.signOutCloud();
                  } else {
                    await plugin.beginCloudSignIn();
                  }
                  actions.refresh();
                } catch (error) {
                  new Notice(formatError(error));
                }
              }),
          );
      }, { aliases: ["sign in", "sign out"] }),
      row("Mobile sync source vault", (setting) => {
        setting.setDesc(
          `${settings.vaultName}. This installation publishes only the open vault's persistent identity. Vault names are display labels and are never merged.`,
        );
      }, { visible: () => plugin.isCloudSignedIn() }),
      row("Stable task IDs", (setting) => {
        setting.setDesc("Checking vault…");
        void plugin
          .countStableIdBackfillCandidates()
          .then((count) => {
            setting.setDesc(
              count === 0
                ? "Every supported task already has a stable ID."
                : `${count} existing task${count === 1 ? "" : "s"} can be normalized.`,
            );
          })
          .catch(() => setting.setDesc("Vault scan unavailable."));
      }, { aliases: ["block IDs", "task identity"], searchable: false }),
      row("Stable-ID mode", (setting) => {
        setting
          .setDesc(
            "Backfill is the recommended mode and keeps task identity stable when notes or task lines move. Existing IDs are never removed.",
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOption("backfill_and_future", "Backfill existing + future")
              .addOption("future_only", "New tasks only")
              .setValue(settings.cloudIdentityMode)
              .onChange(async (value) => {
                try {
                  await actions.setStableIdMode(value as StableIdMode);
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              }),
          );
      }, { aliases: ["stable IDs", "backfill"] }),
      row("Mobile task sync", (setting) => {
        setting
          .setName(
            settings.cloudSyncEnabled
              ? "Mobile task sync enabled"
              : "Sync tasks to Dainvo mobile",
          )
          .setDesc(
            settings.cloudSyncEnabled
              ? "The selected publisher relays task projections and applies queued complete/reopen actions."
              : "Enabling performs a fresh scan and initial publication. An offline failure remains enabled and retryable.",
          )
          .addButton((button) => {
            if (settings.cloudSyncEnabled) {
              button.setButtonText("Sync now").onClick(async () => {
                try {
                  await plugin.syncCloudNow();
                  new Notice("Dainvo mobile task sync finished.");
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              });
              return;
            }
            button
              .setButtonText("Enable")
              .setCta()
              .onClick(async () => {
                try {
                  await actions.enableCloudSync();
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              });
          });
      }, { aliases: ["cloud sync", "sync now", "enable sync"] }),
      row("Another publisher owns this vault", (setting) => {
        setting
          .setDesc(
            "Takeover is never automatic. This stops two Obsidian installations or Dainvo desktop from competing over Markdown writes.",
          )
          .addButton((button) =>
            setDestructiveButton(button.setButtonText("Use this device"))
              .onClick(async () => {
                try {
                  await actions.useThisDeviceAsPublisher();
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              }),
          );
      }, { visible: () => settings.cloudStatus === "paused_other_publisher" }),
      row("Another Obsidian vault is synced", (setting) => {
        setting
          .setDesc(
            "A Dainvo account can sync one Obsidian vault to mobile. Replacing it is explicit and never uses the vault name as identity.",
          )
          .addButton((button) =>
            setDestructiveButton(button.setButtonText("Replace with this vault"))
              .onClick(async () => {
                try {
                  await actions.enableCloudSync();
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              }),
          );
      }, { visible: () => settings.cloudStatus === "paused_vault_replacement" }),
      row("This vault is linked to another Dainvo account", (setting) => {
        setting
          .setDesc(
            "Relinking is explicit so one user's cloud mapping can never be inherited by another user.",
          )
          .addButton((button) =>
            setDestructiveButton(
              button.setButtonText("Relink to signed-in account"),
            ).onClick(async () => {
              try {
                await plugin.relinkCloudAccount();
              } catch (error) {
                new Notice(formatError(error));
              } finally {
                actions.refresh();
              }
            }),
          );
      }, { visible: () => settings.cloudStatus === "paused_account" }),
      row("Retry sync", (setting) => {
        setting
          .setDesc(
            `Retry code: ${settings.cloudLastErrorCode || "temporary_error"}. No task titles or note paths are included in diagnostics.`,
          )
          .addButton((button) =>
            button.setButtonText("Retry").onClick(async () => {
              try {
                if (settings.cloudStatus === "disable_pending") {
                  await plugin.disableCloudSync();
                } else {
                  await plugin.syncCloudNow();
                }
              } catch (error) {
                new Notice(formatError(error));
              } finally {
                actions.refresh();
              }
            }),
          );
      }, {
        visible: () =>
          settings.cloudStatus === "retryable_error" ||
          settings.cloudStatus === "disable_pending",
      }),
      row("Disable and delete cloud copy", (setting) => {
        setting
          .setDesc(
            "Publishing stops immediately. If cloud deletion cannot be confirmed, the status remains disable pending so you can retry.",
          )
          .addButton((button) =>
            setDestructiveButton(button.setButtonText("Disable and delete"))
              .onClick(async () => {
                try {
                  await actions.disableCloudSync();
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              }),
          );
      }, {
        visible: () =>
          settings.cloudSyncEnabled || settings.cloudStatus === "disable_pending",
      }),
      row("Last mobile publication", (setting) => {
        setting.setDesc(
          `${settings.cloudLastPublishedAt} · pending mobile operations: ${settings.cloudOperationBacklog}`,
        );
      }, { visible: () => Boolean(settings.cloudLastPublishedAt), searchable: false }),
      row("Mobile task sync requires an eligible plan", (setting) => {
        setting
          .setDesc(
            "Cached mobile tasks remain readable, but new relay work is paused.",
          )
          .addButton((button) =>
            button.setButtonText("View plans").onClick(() => {
              window.open(
                "https://dainvo.com/pricing",
                "_blank",
                "noopener,noreferrer",
              );
            }),
          );
      }, { visible: () => settings.cloudStatus === "paused_plan" }),
    ],
  };
}

function buildDesktopBridgeDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  return {
    type: "group",
    heading: "Local Dainvo desktop bridge",
    visible: () => Platform.isDesktopApp,
    items: [
      row("Desktop bridge status", (setting) => {
        setting.setDesc(`Status: ${plugin.settings.lastStatus}`);
      }, { searchable: false }),
      row("Dainvo bridge URL", (setting) => {
        setting
          .setDesc("Use the URL shown by Dainvo desktop when starting Obsidian pairing.")
          .addText((text) =>
            text
              .setPlaceholder("http://127.0.0.1:58234")
              .setValue(plugin.settings.bridgeBaseUrl)
              .onChange(async (value) => {
                plugin.settings.bridgeBaseUrl = value.trim();
                await plugin.saveSettings();
              }),
          );
      }, { aliases: ["localhost", "desktop pairing"] }),
      row("Pairing code", (setting) => {
        setting
          .setDesc("Short-lived code shown by Dainvo desktop.")
          .addText((text) =>
            text
              .setPlaceholder("000000")
              .setValue(plugin.settings.pairingCode)
              .onChange(async (value) => {
                plugin.settings.pairingCode = value.trim();
                await plugin.saveSettings();
              }),
          );
      }),
      row("Desktop pairing", (setting) => {
        setting
          .setDesc(
            "The vault-specific bridge bearer token is stored in Obsidian SecretStorage.",
          )
          .addButton((button) =>
            button
              .setButtonText(plugin.hasDesktopBridgePairing() ? "Re-pair" : "Pair")
              .setCta()
              .onClick(async () => {
                try {
                  await plugin.pairWithDainvo();
                  new Notice("Dainvo desktop pairing complete.");
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              }),
          )
          .addButton((button) =>
            button
              .setButtonText("Disconnect")
              .setDisabled(!plugin.hasDesktopBridgePairing())
              .onClick(async () => {
                await plugin.unpairDesktopBridge();
                actions.refresh();
              }),
          );
      }, { aliases: ["pair", "disconnect"] }),
      row("Sync desktop bridge now", (setting) => {
        setting
          .setDesc("Pushes a complete local task snapshot to Dainvo desktop.")
          .addButton((button) =>
            button
              .setButtonText("Sync")
              .setDisabled(!plugin.hasDesktopBridgePairing())
              .onClick(async () => {
                try {
                  await plugin.pushSnapshotNow();
                  new Notice("Dainvo desktop snapshot sent.");
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              }),
          );
      }, { aliases: ["snapshot", "desktop sync"] }),
    ],
  };
}

function buildDailyNoteDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "Daily Notes task creation",
    visible: () => Platform.isDesktopApp,
    items: [
      row("Daily Notes status", (setting) => {
        setting.setDesc("Loading…");
        void plugin.resolveDailyNoteSettings().then((resolved) => {
          setting.setDesc(
            `${settings.dailyNoteSettingsOverrideEnabled ? "Override" : "Obsidian"} · format ${resolved.dateFormat} · folder ${resolved.folder || "(vault root)"}`,
          );
        });
      }, { searchable: false }),
      row("Enable Daily Notes task creation", (setting) => {
        setting
          .setDesc("Allows Dainvo desktop to create tasks in today's daily note.")
          .addToggle((toggle) =>
            toggle
              .setValue(settings.dailyNoteCreateEnabled)
              .onChange(async (value) => {
                settings.dailyNoteCreateEnabled = value;
                await plugin.saveSettings();
              }),
          );
      }),
      row("Override Obsidian Daily Notes settings", (setting) => {
        setting
          .setDesc("Off uses active Obsidian Daily Notes or Periodic Notes settings.")
          .addToggle((toggle) =>
            toggle
              .setValue(settings.dailyNoteSettingsOverrideEnabled)
              .onChange(async (value) => {
                settings.dailyNoteSettingsOverrideEnabled = value;
                await plugin.saveSettings();
                actions.refresh();
              }),
          );
      }, { aliases: ["Periodic Notes", "daily note override"] }),
      row("Copy current Obsidian settings", (setting) => {
        setting
          .setDesc("Copies detected format, folder, and template into overrides.")
          .addButton((button) =>
            button.setButtonText("Copy").onClick(async () => {
              await plugin.copyCurrentDailyNoteSettingsToOverrides();
              actions.refresh();
            }),
          );
      }),
      textRow("Date format", "YYYY-MM-DD", () => settings.dailyNoteDateFormat, async (value) => {
        settings.dailyNoteDateFormat = value.trim();
        await plugin.saveSettings();
      }, () => !settings.dailyNoteSettingsOverrideEnabled),
      textRow("Folder", "Daily", () => settings.dailyNoteFolder, async (value) => {
        settings.dailyNoteFolder = value.trim();
        await plugin.saveSettings();
      }, () => !settings.dailyNoteSettingsOverrideEnabled),
      textRow("Template path", "Templates/Daily.md", () => settings.dailyNoteTemplatePath, async (value) => {
        settings.dailyNoteTemplatePath = value.trim();
        await plugin.saveSettings();
      }, () => !settings.dailyNoteSettingsOverrideEnabled),
      textRow("Section heading", "## Dainvo", () => settings.dailyNoteSectionHeading, async (value) => {
        settings.dailyNoteSectionHeading = value.trim() || "## Dainvo";
        await plugin.saveSettings();
      }),
    ],
  };
}

function buildItemNoteDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "Dainvo item notes",
    visible: () => Platform.isDesktopApp,
    items: [
      infoRow(
        "About Dainvo item notes",
        "Controls where Dainvo creates Markdown notes for calendar events, meetings, and buckets in this vault. Changes are exported to a paired Dainvo desktop app.",
      ),
      row("Note placement", (setting) => {
        setting
          .setDesc(
            "Store item notes beside the matching daily note, or under a dedicated vault-relative folder.",
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOption("daily-note-folder", "Beside Daily Notes")
              .addOption("dedicated-folder", "Dedicated folder")
              .setValue(settings.itemNotePlacement)
              .onChange(async (value) => {
                settings.itemNotePlacement = value as
                  | "daily-note-folder"
                  | "dedicated-folder";
                try {
                  await plugin.saveItemNoteSettings();
                } catch (error) {
                  new Notice(formatError(error));
                } finally {
                  actions.refresh();
                }
              }),
          );
      }, { aliases: ["item note folder"] }),
      row("Dedicated folder", (setting) => {
        setting
          .setDesc("A relative path inside this vault.")
          .addText((text) =>
            text
              .setPlaceholder("Item notes")
              .setDisabled(settings.itemNotePlacement !== "dedicated-folder")
              .setValue(settings.itemNoteFolder)
              .onChange(async (value) => {
                const previous = settings.itemNoteFolder;
                settings.itemNoteFolder = value.trim();
                try {
                  plugin.resolveItemNoteSettings();
                  await plugin.saveItemNoteSettings();
                } catch (error) {
                  settings.itemNoteFolder = previous;
                  new Notice(formatError(error));
                }
              }),
          );
      }),
      row("Create a day folder", (setting) => {
        setting
          .setDesc(
            "In dedicated mode, add a dd mm yyyy directory below the year and month.",
          )
          .addToggle((toggle) =>
            toggle
              .setDisabled(settings.itemNotePlacement !== "dedicated-folder")
              .setValue(settings.itemNoteUseDayFolder)
              .onChange(async (value) => {
                settings.itemNoteUseDayFolder = value;
                try {
                  await plugin.saveItemNoteSettings();
                } catch (error) {
                  new Notice(formatError(error));
                }
              }),
          );
      }),
      row("Include start time", (setting) => {
        setting
          .setDesc("Adds hh-mm before the title for timed items.")
          .addToggle((toggle) =>
            toggle
              .setValue(settings.itemNoteIncludeStartTime)
              .onChange(async (value) => {
                settings.itemNoteIncludeStartTime = value;
                try {
                  await plugin.saveItemNoteSettings();
                } catch (error) {
                  new Notice(formatError(error));
                }
              }),
          );
      }),
      row("New note content", (setting) => {
        setting
          .setDesc("Start new Markdown files blank or with the saved title as h1.")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("title-heading", "Title as heading")
              .addOption("blank", "Blank")
              .setValue(settings.itemNoteInitialContent)
              .onChange(async (value) => {
                settings.itemNoteInitialContent = value as
                  | "blank"
                  | "title-heading";
                try {
                  await plugin.saveItemNoteSettings();
                } catch (error) {
                  new Notice(formatError(error));
                }
              }),
          );
      }),
    ],
  };
}

function buildProjectNoteDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "Dainvo project notes",
    visible: () => Platform.isDesktopApp,
    items: [
      infoRow(
        "About Dainvo project notes",
        "Choose the vault-relative Projects directory used by a paired Dainvo desktop app. Project note files and Markdown content remain local to this vault.",
      ),
      row("Projects folder", (setting) => {
        setting
          .setDesc(
            "Select an existing vault folder or enter a safe relative path. Dainvo creates it when the first project note is added.",
          )
          .addText((input) => {
            input
              .setPlaceholder("Projects")
              .setValue(settings.projectNoteFolder)
              .onChange(async (value) => {
                const previous = settings.projectNoteFolder;
                settings.projectNoteFolder = value.trim();
                try {
                  await plugin.saveProjectNoteSettings();
                } catch (error) {
                  settings.projectNoteFolder = previous;
                  new Notice(formatError(error));
                }
              });
            new VaultFolderSuggest(plugin, input);
          });
      }, { aliases: ["project note folder", "Projects directory"] }),
    ],
  };
}

class VaultFolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    private readonly plugin: DainvoTaskManagerPlugin,
    private readonly input: TextComponent,
  ) {
    super(plugin.app, input.inputEl);
  }

  getSuggestions(query: string): TFolder[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return this.plugin.app.vault
      .getAllLoadedFiles()
      .filter((entry): entry is TFolder => entry instanceof TFolder)
      .filter((folder) =>
        normalizedQuery
          ? folder.path.toLocaleLowerCase().includes(normalizedQuery)
          : true,
      )
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  renderSuggestion(folder: TFolder, element: HTMLElement): void {
    element.setText(folder.path || "/");
  }

  selectSuggestion(folder: TFolder): void {
    this.input.setValue(folder.path);
    this.input.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    this.close();
  }
}

function row(
  name: string,
  render: (setting: Setting) => void,
  options: Pick<
    DainvoSettingRow,
    "aliases" | "desc" | "searchable" | "visible"
  > = {},
): DainvoSettingRow {
  return { name, render, ...options };
}

function infoRow(name: string, desc: string): DainvoSettingRow {
  return row(name, (setting) => {
    setting.setDesc(desc);
  }, {
    desc,
    searchable: false,
  });
}

function textRow(
  name: string,
  placeholder: string,
  value: () => string,
  onChange: (value: string) => Promise<void>,
  disabled: () => boolean = () => false,
): DainvoSettingRow {
  return row(name, (setting) => {
    setting.addText((text) =>
      text
        .setPlaceholder(placeholder)
        .setDisabled(disabled())
        .setValue(value())
        .onChange(onChange),
    );
  });
}

type DestructiveButtonCompatibility = {
  setDestructive?: () => ButtonComponent;
};

function setDestructiveButton(button: ButtonComponent): ButtonComponent {
  const setDestructive = (
    button as unknown as DestructiveButtonCompatibility
  ).setDestructive;
  if (typeof setDestructive === "function") {
    return setDestructive.call(button);
  }
  button.buttonEl.addClass("mod-warning");
  return button;
}

function cloudStatusText(status: string): string {
  const labels: Record<string, string> = {
    disabled: "Disabled",
    signing_in: "Waiting for browser sign-in",
    normalizing_ids: "Adding or checking stable task IDs",
    publishing: "Publishing task projections",
    published: "Published",
    retryable_error: "Temporarily unavailable; retry scheduled",
    paused_signed_out: "Paused: sign in required",
    paused_plan: "Paused: plan does not include mobile sync",
    paused_account: "Paused: linked account differs",
    paused_other_publisher: "Paused: another vault publisher is selected",
    paused_vault_replacement: "Paused: another Obsidian vault is synced",
    disable_pending: "Disable pending: cloud deletion not yet confirmed",
  };
  return labels[status] ?? status;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
