import { Modal, Notice, Platform, PluginSettingTab, Setting } from "obsidian";

import type DainvoTaskManagerPlugin from "./main";
import type { CloudPublisherVault, StableIdMode } from "./types";

export class DainvoTaskManagerSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: DainvoTaskManagerPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.renderCloudSettings();
    if (Platform.isDesktopApp) {
      this.renderDesktopBridgeSettings();
      this.renderDailyNoteSettings();
    }
  }

  private renderCloudSettings(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    new Setting(containerEl)
      .setName("Dainvo mobile task sync")
      .setHeading();
    containerEl.createEl("p", {
      text:
        "Sync task fields through Dainvo so they remain available offline in Dainvo mobile. Vault files, Markdown bodies, raw task lines, attachments, and full filesystem paths are never uploaded.",
    });
    containerEl.createEl("p", {
      cls: "dainvo-task-manager-status",
      text: `Status: ${cloudStatusText(settings.cloudStatus)}`,
    });

    const accountStatus = containerEl.createEl("p", {
      cls: "dainvo-task-manager-status",
      text: this.plugin.isCloudSignedIn()
        ? `Dainvo account: ${this.plugin.cloudSignedInAccountLabel()}${settings.cloudPlanName ? ` · ${settings.cloudPlanName}` : " · checking plan…"}`
        : "Dainvo account: signed out",
    });
    if (this.plugin.isCloudSignedIn()) {
      void this.plugin
        .refreshCloudAccessStatus()
        .then((access) => {
          accountStatus.setText(
            `Dainvo account: ${this.plugin.cloudSignedInAccountLabel()} · ${access.planName || "Unknown plan"} · ${access.allowed ? "mobile sync included" : "upgrade required"}`,
          );
        })
        .catch(() => {
          accountStatus.setText(
            `Dainvo account: ${this.plugin.cloudSignedInAccountLabel()} · plan check unavailable`,
          );
        });
    }

    new Setting(containerEl)
      .setName(this.plugin.isCloudSignedIn() ? "Dainvo account" : "Sign in to Dainvo")
      .setDesc(
        this.plugin.isCloudSignedIn()
          ? `Signed in as ${this.plugin.cloudSignedInAccountLabel()}. Signing out pauses this vault without deleting its cloud copy.`
          : "Opens the Dainvo account site and returns here through Obsidian after secure PKCE authorization.",
      )
      .addButton((button) =>
        button
          .setButtonText(this.plugin.isCloudSignedIn() ? "Sign out" : "Sign in")
          .onClick(async () => {
            try {
              if (this.plugin.isCloudSignedIn()) {
                await this.plugin.signOutCloud();
              } else {
                await this.plugin.beginCloudSignIn();
              }
              this.render();
            } catch (error) {
              new Notice(formatError(error));
            }
          }),
      );

    if (this.plugin.isCloudSignedIn()) {
      this.renderCloudVaultPicker();
    }

    const candidateStatus = containerEl.createEl("p", {
      cls: "dainvo-task-manager-status",
      text: "Stable task IDs: checking vault…",
    });
    void this.plugin
      .countStableIdBackfillCandidates()
      .then((count) => {
        candidateStatus.setText(
          count === 0
            ? "Stable task IDs: every supported task already has one."
            : `Stable task IDs: ${count} existing task${count === 1 ? "" : "s"} can be normalized.`,
        );
      })
      .catch(() => candidateStatus.setText("Stable task IDs: scan unavailable."));

    new Setting(containerEl)
      .setName("Stable-ID mode")
      .setDesc(
        "Backfill is the recommended mode and keeps task identity stable when notes or task lines move. Existing IDs are never removed.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("backfill_and_future", "Backfill existing + future")
          .addOption("future_only", "New tasks only")
          .setValue(settings.cloudIdentityMode)
          .onChange(async (value) => {
            const mode = value as StableIdMode;
            if (
              mode === "backfill_and_future" &&
              settings.cloudIdentityMode !== "backfill_and_future"
            ) {
              const count = await this.plugin.countStableIdBackfillCandidates();
              if (count > 0 && !(await confirmBackfill(this.plugin, count))) {
                this.render();
                return;
              }
            }
            try {
              await this.plugin.setStableIdMode(mode);
              this.render();
            } catch (error) {
              new Notice(formatError(error));
              this.render();
            }
          }),
      );

    new Setting(containerEl)
      .setName(settings.cloudSyncEnabled ? "Mobile task sync enabled" : "Sync tasks to Dainvo mobile")
      .setDesc(
        settings.cloudSyncEnabled
          ? "The selected publisher relays task projections and applies queued complete/reopen actions."
          : "Enabling performs a fresh scan and initial publication. An offline failure remains enabled and retryable.",
      )
      .addButton((button) => {
        if (settings.cloudSyncEnabled) {
          button.setButtonText("Sync now").onClick(async () => {
            try {
              await this.plugin.syncCloudNow();
              new Notice("Dainvo mobile task sync finished.");
              this.render();
            } catch (error) {
              new Notice(formatError(error));
              this.render();
            }
          });
          return;
        }
        button.setButtonText("Enable").setCta().onClick(async () => {
          try {
            if (settings.cloudIdentityMode === "backfill_and_future") {
              const count = await this.plugin.countStableIdBackfillCandidates();
              if (count > 0 && !(await confirmBackfill(this.plugin, count))) {
                return;
              }
            }
            await this.plugin.enableCloudSync();
            this.render();
          } catch (error) {
            new Notice(formatError(error));
            this.render();
          }
        });
      });

    if (settings.cloudStatus === "paused_other_publisher") {
      new Setting(containerEl)
        .setName("Another publisher owns this vault")
        .setDesc(
          "Takeover is never automatic. This stops two Obsidian installations or Dainvo desktop from competing over Markdown writes.",
        )
        .addButton((button) =>
          button.setButtonText("Use this device").setWarning().onClick(async () => {
            if (!(await confirmPublisherTakeover(this.plugin))) {
              return;
            }
            try {
              await this.plugin.useThisDeviceAsPublisher();
              this.render();
            } catch (error) {
              new Notice(formatError(error));
              this.render();
            }
          }),
        );
    }

    if (settings.cloudStatus === "paused_account") {
      new Setting(containerEl)
        .setName("This vault is linked to another Dainvo account")
        .setDesc("Relinking is explicit so one user's cloud mapping can never be inherited by another user.")
        .addButton((button) =>
          button.setButtonText("Relink to signed-in account").setWarning().onClick(async () => {
            try {
              await this.plugin.relinkCloudAccount();
              this.render();
            } catch (error) {
              new Notice(formatError(error));
            }
          }),
        );
    }

    if (
      settings.cloudStatus === "retryable_error" ||
      settings.cloudStatus === "disable_pending"
    ) {
      new Setting(containerEl)
        .setName("Retry sync")
        .setDesc(
          `Retry code: ${settings.cloudLastErrorCode || "temporary_error"}. No task titles or note paths are included in diagnostics.`,
        )
        .addButton((button) =>
          button.setButtonText("Retry").onClick(async () => {
            try {
              if (settings.cloudStatus === "disable_pending") {
                await this.plugin.disableCloudSync();
              } else {
                await this.plugin.syncCloudNow();
              }
              this.render();
            } catch (error) {
              new Notice(formatError(error));
              this.render();
            }
          }),
        );
    }

    if (settings.cloudSyncEnabled || settings.cloudStatus === "disable_pending") {
      new Setting(containerEl)
        .setName("Disable and delete cloud copy")
        .setDesc(
          "Publishing stops immediately. If cloud deletion cannot be confirmed, the status remains Disable pending so you can retry.",
        )
        .addButton((button) =>
          button.setButtonText("Disable and delete").setWarning().onClick(async () => {
            if (!(await confirmDisable(this.plugin))) {
              return;
            }
            try {
              await this.plugin.disableCloudSync();
              this.render();
            } catch (error) {
              new Notice(formatError(error));
              this.render();
            }
          }),
        );
    }

    if (settings.cloudLastPublishedAt) {
      containerEl.createEl("p", {
        cls: "dainvo-task-manager-status",
        text: `Last published: ${settings.cloudLastPublishedAt} · pending mobile operations: ${settings.cloudOperationBacklog}`,
      });
    }
    if (settings.cloudStatus === "paused_plan") {
      new Setting(containerEl)
        .setName("Mobile task sync requires an eligible plan")
        .setDesc("Cached mobile tasks remain readable, but new relay work is paused.")
        .addButton((button) =>
          button.setButtonText("View plans").onClick(() => {
            window.open("https://dainvo.com/pricing", "_blank", "noopener,noreferrer");
          }),
        );
    }
  }

  private renderCloudVaultPicker(): void {
    const setting = new Setting(this.containerEl)
      .setName("Cloud vault mapping")
      .setDesc(
        "Choose an existing mapping or create one for this vault. Selecting an existing mapping never takes publisher ownership automatically.",
      );
    setting.addDropdown((dropdown) => {
      dropdown.addOption("__new__", "Create mapping for this vault");
      dropdown.setValue(this.plugin.settings.cloudVaultId || "__new__");
      const vaultsById = new Map<string, CloudPublisherVault>();
      dropdown.onChange(async (value) => {
        try {
          await this.plugin.selectCloudVault(
            value === "__new__" ? null : (vaultsById.get(value) ?? null),
          );
          this.render();
        } catch (error) {
          new Notice(formatError(error));
        }
      });

      void this.plugin
        .listCloudVaults()
        .then((vaults) => {
          for (const vault of vaults) {
            vaultsById.set(vault.id, vault);
            dropdown.addOption(
              vault.id,
              `${vault.vault_name} · ${vault.publisher_kind === "obsidian_plugin" ? "Obsidian plugin" : "Dainvo desktop"}`,
            );
          }
          dropdown.setValue(this.plugin.settings.cloudVaultId || "__new__");
        })
        .catch(() => undefined);
    });
  }

  private renderDesktopBridgeSettings(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("Local Dainvo desktop bridge").setHeading();
    containerEl.createEl("p", {
      cls: "dainvo-task-manager-status",
      text: `Status: ${this.plugin.settings.lastStatus}`,
    });
    new Setting(containerEl)
      .setName("Dainvo bridge URL")
      .setDesc("Use the URL shown by Dainvo desktop when starting Obsidian pairing.")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:58234")
          .setValue(this.plugin.settings.bridgeBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.bridgeBaseUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Pairing code")
      .setDesc("Short-lived code shown by Dainvo desktop.")
      .addText((text) =>
        text
          .setPlaceholder("000000")
          .setValue(this.plugin.settings.pairingCode)
          .onChange(async (value) => {
            this.plugin.settings.pairingCode = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Desktop pairing")
      .setDesc("The vault-specific bridge bearer token is stored in Obsidian SecretStorage.")
      .addButton((button) =>
        button
          .setButtonText(this.plugin.hasDesktopBridgePairing() ? "Re-pair" : "Pair")
          .setCta()
          .onClick(async () => {
            try {
              await this.plugin.pairWithDainvo();
              new Notice("Dainvo desktop pairing complete.");
              this.render();
            } catch (error) {
              new Notice(formatError(error));
            }
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Disconnect")
          .setDisabled(!this.plugin.hasDesktopBridgePairing())
          .onClick(async () => {
            await this.plugin.unpairDesktopBridge();
            this.render();
          }),
      );

    new Setting(containerEl)
      .setName("Sync desktop bridge now")
      .setDesc("Pushes a complete local task snapshot to Dainvo desktop.")
      .addButton((button) =>
        button
          .setButtonText("Sync")
          .setDisabled(!this.plugin.hasDesktopBridgePairing())
          .onClick(async () => {
            try {
              await this.plugin.pushSnapshotNow();
              new Notice("Dainvo desktop snapshot sent.");
              this.render();
            } catch (error) {
              new Notice(formatError(error));
            }
          }),
      );
  }

  private renderDailyNoteSettings(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("Daily Notes task creation").setHeading();
    const overrideEnabled = this.plugin.settings.dailyNoteSettingsOverrideEnabled;
    const status = containerEl.createEl("p", {
      cls: "dainvo-task-manager-status",
      text: "Daily Notes settings: loading…",
    });
    void this.plugin.resolveDailyNoteSettings().then((resolved) => {
      status.setText(
        `Daily Notes settings: ${overrideEnabled ? "override" : "Obsidian"} · format ${resolved.dateFormat} · folder ${resolved.folder || "(vault root)"}`,
      );
    });

    new Setting(containerEl)
      .setName("Enable Daily Notes task creation")
      .setDesc("Allows Dainvo desktop to create tasks in today's daily note.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.dailyNoteCreateEnabled)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteCreateEnabled = value;
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Override Obsidian Daily Notes settings")
      .setDesc("Off uses active Obsidian Daily Notes or Periodic Notes settings.")
      .addToggle((toggle) =>
        toggle
          .setValue(overrideEnabled)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteSettingsOverrideEnabled = value;
            await this.plugin.saveSettings();
            this.render();
          }),
      );
    new Setting(containerEl)
      .setName("Copy current Obsidian settings")
      .setDesc("Copies detected format, folder, and template into overrides.")
      .addButton((button) =>
        button.setButtonText("Copy").onClick(async () => {
          await this.plugin.copyCurrentDailyNoteSettingsToOverrides();
          this.render();
        }),
      );
    new Setting(containerEl)
      .setName("Date format")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setDisabled(!overrideEnabled)
          .setValue(this.plugin.settings.dailyNoteDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteDateFormat = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Folder")
      .addText((text) =>
        text
          .setPlaceholder("Daily")
          .setDisabled(!overrideEnabled)
          .setValue(this.plugin.settings.dailyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Template path")
      .addText((text) =>
        text
          .setPlaceholder("Templates/Daily.md")
          .setDisabled(!overrideEnabled)
          .setValue(this.plugin.settings.dailyNoteTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteTemplatePath = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Section heading")
      .addText((text) =>
        text
          .setPlaceholder("## Dainvo")
          .setValue(this.plugin.settings.dailyNoteSectionHeading)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteSectionHeading = value.trim() || "## Dainvo";
            await this.plugin.saveSettings();
          }),
      );
  }
}

async function confirmBackfill(
  plugin: DainvoTaskManagerPlugin,
  count: number,
): Promise<boolean> {
  return confirmAction(
    plugin,
    "Add stable IDs to existing tasks?",
    `Dainvo will append an Obsidian block ID to ${count} supported task${count === 1 ? "" : "s"}. Each file is revalidated and changed atomically. Existing IDs are preserved, and a restart-safe journal resumes interrupted work.`,
    "Add stable IDs",
  );
}

async function confirmPublisherTakeover(
  plugin: DainvoTaskManagerPlugin,
): Promise<boolean> {
  return confirmAction(
    plugin,
    "Use this device as publisher?",
    "The current desktop or Obsidian publisher will pause. Only this installation will insert stable IDs and apply mobile complete/reopen actions.",
    "Use this device",
  );
}

async function confirmDisable(
  plugin: DainvoTaskManagerPlugin,
): Promise<boolean> {
  return confirmAction(
    plugin,
    "Disable sync and delete the cloud copy?",
    "Task projections and pending relay operations for this vault will be deleted from Dainvo. Your Markdown and stable block IDs remain unchanged.",
    "Disable and delete",
  );
}

function confirmAction(
  plugin: DainvoTaskManagerPlugin,
  title: string,
  description: string,
  confirmLabel: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmationModal(
      plugin,
      title,
      description,
      confirmLabel,
      resolve,
    ).open();
  });
}

class ConfirmationModal extends Modal {
  private resolved = false;

  constructor(
    plugin: DainvoTaskManagerPlugin,
    private readonly titleText: string,
    private readonly description: string,
    private readonly confirmLabel: string,
    private readonly resolveResult: (result: boolean) => void,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.description });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.finish(false)),
      )
      .addButton((button) =>
        button
          .setButtonText(this.confirmLabel)
          .setWarning()
          .onClick(() => this.finish(true)),
      );
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.resolveResult(false);
    }
    this.contentEl.empty();
  }

  private finish(result: boolean): void {
    if (!this.resolved) {
      this.resolved = true;
      this.resolveResult(result);
    }
    this.close();
  }
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
    disable_pending: "Disable pending: cloud deletion not yet confirmed",
  };
  return labels[status] ?? status;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
