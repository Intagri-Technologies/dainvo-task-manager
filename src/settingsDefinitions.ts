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
import type { DainvoPluginSettings, StableIdMode } from "./types";

export type DainvoSettingsActions = {
  refresh: () => void;
  openDesktopPairing: () => void;
  openMobileSyncOptions: () => void;
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
    {
      type: "group",
      heading: "Account and connections",
      items: [
        ...(buildAccountDefinitions(plugin, actions).items ?? []),
        row("Desktop pairing", (setting) => {
          const paired = plugin.hasDesktopBridgePairing();
          setting.setDesc(paired ? desktopStatusText(plugin.settings.lastStatus) : "Not connected. Pair this vault with Dainvo desktop.");
          if (paired) {
            setting.addButton((button) => button.setButtonText("Sync now").onClick(async () => {
              try {
                await plugin.pushSnapshotNow();
                new Notice("Dainvo desktop tasks synced.");
              } catch (error) {
                new Notice(formatError(error));
              } finally {
                actions.refresh();
              }
            }));
          }
          setting.addButton((button) => button
            .setButtonText("Pairing")
            .onClick(actions.openDesktopPairing));
        }, { visible: () => Platform.isDesktopApp, aliases: ["bridge", "Dainvo bridge URL", "pairing code", "desktop sync", "disconnect"] }),
        buildMobileSyncRow(plugin, actions),
      ],
    },
    buildGeneralDefinitions(plugin, actions),
    buildDailyNoteDefinitions(plugin, actions),
    buildItemNoteDefinitions(plugin, actions),
    buildProjectNoteDefinitions(plugin, actions),
  ];
}

function buildAccountDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "Dainvo account",
    items: [
      row("Dainvo account", (setting) => {
        const signedIn = plugin.isCloudSignedIn();
        const accountDescription = (plan = settings.cloudPlanName || "Checking plan…") =>
          `${plugin.cloudSignedInAccountLabel()} · ${plan}`;
        setting
          .setName("Dainvo account")
          .setDesc(
            signedIn
              ? accountDescription()
              : "Not signed in. Use the same Dainvo account you use on your phone.",
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
        if (signedIn) {
          void plugin.refreshCloudAccessStatus().then((access) => {
            setting.setDesc(accountDescription(
              `${access.planName || "Unknown plan"} · ${access.allowed ? "Mobile sync included" : "Upgrade needed for mobile sync"}`,
            ));
          }).catch(() => setting.setDesc(accountDescription("Plan check unavailable")));
        }
      }, { aliases: ["sign in", "sign out", "account plan"] }),
    ],
  };
}

function buildMobileSyncRow(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): DainvoSettingRow {
  const settings = plugin.settings;
  return row("Mobile task sync", (setting) => {
    setting
      .setName(
        settings.cloudSyncEnabled
          ? "Mobile sync"
          : "Enable mobile sync",
      )
      .setDesc(
        settings.cloudSyncEnabled
          ? mobileSyncDescription(settings)
          : `${settings.vaultName} · ${plugin.isCloudSignedIn() ? "Off. Enable to sync task details with your phone." : "Sign in above to enable mobile sync."}`,
      )
      .addButton((button) => {
        button.setDisabled(!plugin.isCloudSignedIn());
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
      })
      .addButton((button) => button.setButtonText("Options").onClick(actions.openMobileSyncOptions));
  }, { aliases: ["cloud sync", "sync now", "enable sync", "disable sync", "delete cloud copy", "publisher", "retry sync"] });
}

function buildCloudRecoveryDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "Dainvo mobile sync",
    items: [
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
    ],
  };
}

export function buildMobileSyncOptions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionItem[] {
  return [
    {
      type: "group",
      items: [
        infoRow("Sync status", mobileSyncDescription(plugin.settings)),
        infoRow("About mobile sync", "Keep Obsidian open to send and receive task changes. Only task details are synced; full notes and attachments stay in your vault. One vault can be synced per Dainvo account."),
        ...(buildCloudRecoveryDefinitions(plugin, actions).items ?? []),
      ],
    },
    buildCloudManagementDefinitions(plugin, actions),
  ];
}

function buildGeneralDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "General",
    items: [
      row("Task markers", (setting) => {
        setting
          .setDesc(
            "Markers let Dainvo recognize tasks when you move or edit them. Add them to existing and new tasks for reliable sync. Existing markers are kept.",
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOption("backfill_and_future", "Existing and new tasks (recommended)")
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
      }, { aliases: ["stable IDs", "Stable-ID mode", "block IDs", "backfill"] }),
      row("Existing task markers", (setting) => {
        setting.setDesc("Checking vault…");
        void plugin
          .countStableIdBackfillCandidates()
          .then((count) => {
            setting.setDesc(
              count === 0
                ? "All supported tasks already have markers."
                : `${count} existing task${count === 1 ? "" : "s"} can receive markers.`,
            );
          })
          .catch(() => setting.setDesc("Vault scan unavailable."));
      }, { aliases: ["block IDs", "task identity"], searchable: false }),
    ],
  };
}

function buildCloudManagementDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  const settings = plugin.settings;
  return {
    type: "group",
    heading: "Manage mobile sync",
    visible: () => settings.cloudSyncEnabled || settings.cloudStatus === "disable_pending",
    items: [
      row("Disable and delete cloud copy", (setting) => {
        setting
          .setDesc(
            "Stop mobile sync and delete this vault's synced tasks and waiting changes from Dainvo. Your Obsidian notes and task markers stay in place.",
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
    ],
  };
}

export function buildDesktopPairingDefinitions(
  plugin: DainvoTaskManagerPlugin,
  actions: DainvoSettingsActions,
): SettingDefinitionGroup {
  return {
    type: "group",
    visible: () => Platform.isDesktopApp,
    items: [
      infoRow("Connection status", plugin.hasDesktopBridgePairing() ? plugin.settings.lastStatus : "Not paired"),
      infoRow("Connect this vault", "Start an Obsidian pairing session in Dainvo desktop, then enter the bridge URL and pairing code it shows."),
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
            "Pairing connects only this vault to Dainvo desktop. Disconnecting keeps your notes in place.",
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
    heading: "Daily Notes",
    visible: () => Platform.isDesktopApp,
    items: [
      row("Enable Daily Notes task creation", (setting) => {
        setting
          .setDesc("Allow Dainvo desktop to add tasks to today's daily note.")
          .addToggle((toggle) =>
            toggle
              .setValue(settings.dailyNoteCreateEnabled)
              .onChange(async (value) => {
                settings.dailyNoteCreateEnabled = value;
                await plugin.saveSettings();
                actions.refresh();
              }),
          );
        if (settings.dailyNoteCreateEnabled) {
          void plugin.resolveDailyNoteSettings().then((resolved) => {
            setting.setDesc(`Using ${settings.dailyNoteSettingsOverrideEnabled ? "custom settings" : "Obsidian Daily Notes or Periodic Notes"} · ${resolved.dateFormat} · ${resolved.folder || "vault root"}`);
          }).catch(() => setting.setDesc("Daily note settings could not be read. Check that Daily Notes or Periodic Notes is enabled."));
        }
      }),
      row("Use custom Daily Notes settings", (setting) => {
        setting
          .setDesc("Use a different date format, folder or template for tasks created by Dainvo. Leave off to follow Obsidian.")
          .addToggle((toggle) =>
            toggle
              .setValue(settings.dailyNoteSettingsOverrideEnabled)
              .onChange(async (value) => {
                settings.dailyNoteSettingsOverrideEnabled = value;
                await plugin.saveSettings();
                actions.refresh();
              }),
          );
      }, { aliases: ["Periodic Notes", "daily note override", "Override Obsidian Daily Notes settings"], visible: () => settings.dailyNoteCreateEnabled }),
      row("Copy current Obsidian settings", (setting) => {
        setting
          .setDesc("Copies detected format, folder, and template into overrides.")
          .addButton((button) =>
            button.setButtonText("Copy").onClick(async () => {
              await plugin.copyCurrentDailyNoteSettingsToOverrides();
              actions.refresh();
            }),
          );
      }, { visible: () => settings.dailyNoteCreateEnabled && settings.dailyNoteSettingsOverrideEnabled }),
      textRow("Date format", "YYYY-MM-DD", () => settings.dailyNoteDateFormat, async (value) => {
        settings.dailyNoteDateFormat = value.trim();
        await plugin.saveSettings();
      }, () => settings.dailyNoteCreateEnabled && settings.dailyNoteSettingsOverrideEnabled),
      textRow("Folder", "Daily", () => settings.dailyNoteFolder, async (value) => {
        settings.dailyNoteFolder = value.trim();
        await plugin.saveSettings();
      }, () => settings.dailyNoteCreateEnabled && settings.dailyNoteSettingsOverrideEnabled),
      textRow("Template path", "Templates/Daily.md", () => settings.dailyNoteTemplatePath, async (value) => {
        settings.dailyNoteTemplatePath = value.trim();
        await plugin.saveSettings();
      }, () => settings.dailyNoteCreateEnabled && settings.dailyNoteSettingsOverrideEnabled),
      textRow("Section heading", "## Dainvo", () => settings.dailyNoteSectionHeading, async (value) => {
        settings.dailyNoteSectionHeading = value.trim() || "## Dainvo";
        await plugin.saveSettings();
      }, () => settings.dailyNoteCreateEnabled),
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
    heading: "Event, meeting and bucket notes",
    visible: () => Platform.isDesktopApp,
    items: [
      row("Note placement", (setting) => {
        setting
          .setDesc(
            "Keep event, meeting and bucket notes beside Daily Notes, or in their own folder. Note files stay in your vault.",
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
      }, { visible: () => settings.itemNotePlacement === "dedicated-folder" }),
      row("Create a day folder", (setting) => {
        setting
          .setDesc(
            "Add a day folder named dd mm yyyy inside the year and month folders.",
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
      }, { visible: () => settings.itemNotePlacement === "dedicated-folder" }),
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
          .setDesc("Start with an empty note or add the event, meeting or bucket title as a heading.")
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
    heading: "Project notes",
    visible: () => Platform.isDesktopApp,
    items: [
      row("Projects folder", (setting) => {
        setting
          .setDesc(
            "Folder for notes created by Dainvo desktop. Choose an existing folder or enter a new path inside this vault. It is created with the first project note.",
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
  visible: () => boolean = () => true,
): DainvoSettingRow {
  return row(name, (setting) => {
    setting.addText((text) =>
      text
        .setPlaceholder(placeholder)
        .setValue(value())
        .onChange(onChange),
    );
  }, { visible });
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
    normalizing_ids: "Adding or checking task markers…",
    publishing: "Syncing tasks…",
    published: "Up to date",
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

function desktopStatusText(status: string): string {
  if (status === "Paired") return "Connected to Dainvo desktop";
  if (status === "Snapshot sent" || status.startsWith("Polled ")) return "Connected · Up to date";
  return "Paired · Sync needs attention";
}

function mobileSyncDescription(settings: DainvoPluginSettings): string {
  const details = [settings.vaultName, cloudStatusText(settings.cloudStatus)];
  if (settings.cloudLastPublishedAt) details.push(`Last synced ${formatSyncTime(settings.cloudLastPublishedAt)}`);
  if (settings.cloudOperationBacklog > 0) details.push(`${settings.cloudOperationBacklog} waiting mobile change${settings.cloudOperationBacklog === 1 ? "" : "s"}`);
  return details.join(" · ");
}

function formatSyncTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
