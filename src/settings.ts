import {
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  SettingGroup,
  type ButtonComponent,
  type SettingDefinitionItem,
} from "obsidian";

import type DainvoTaskManagerPlugin from "./main";
import { buildDainvoSettingDefinitions } from "./settingsDefinitions";
import type { CloudPublisherVault, StableIdMode } from "./types";

export class DainvoTaskManagerSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: DainvoTaskManagerPlugin) {
    super(plugin.app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return buildDainvoSettingDefinitions(this.plugin, {
      refresh: () => this.refreshDeclarativeSettings(),
      setStableIdMode: (mode) => this.setStableIdModeWithConfirmation(mode),
      enableCloudSync: () => this.enableCloudSyncWithConfirmation(),
      useThisDeviceAsPublisher: () =>
        this.useThisDeviceAsPublisherWithConfirmation(),
      disableCloudSync: () => this.disableCloudSyncWithConfirmation(),
    });
  }

  private refreshDeclarativeSettings(): void {
    const update = Reflect.get(this, "update") as unknown;
    if (typeof update === "function") {
      Reflect.apply(update, this, []);
      return;
    }
    this.renderLegacyDefinitions();
  }

  display(): void {
    this.renderLegacyDefinitions();
  }

  private renderLegacyDefinitions(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const definition of this.getSettingDefinitions()) {
      if (
        !("type" in definition) ||
        definition.type !== "group" ||
        !isDefinitionVisible(definition)
      ) {
        continue;
      }
      const group = new SettingGroup(containerEl);
      if (definition.heading) {
        group.setHeading(definition.heading);
      }
      for (const item of definition.items ?? []) {
        if (!("render" in item) || !item.render || !isDefinitionVisible(item)) {
          continue;
        }
        const setting = new Setting(group.listEl).setName(item.name);
        if (item.desc) {
          setting.setDesc(item.desc);
        }
        item.render(setting, group);
      }
    }
  }

  private async enableCloudSyncWithConfirmation(): Promise<void> {
    const settings = this.plugin.settings;
    if (settings.cloudIdentityMode === "backfill_and_future") {
      const count = await this.plugin.countStableIdBackfillCandidates();
      if (count > 0 && !(await confirmBackfill(this.plugin, count))) {
        return;
      }
    }

    const candidate = await this.plugin.getVaultReplacementCandidate();
    if (
      candidate &&
      !(await confirmVaultReplacement(
        this.plugin,
        candidate,
        settings.vaultName,
      ))
    ) {
      return;
    }

    const replacement = await this.plugin.enableCloudSync(candidate?.id);
    if (replacement) {
      new Notice(
        `Mobile sync now uses ${settings.vaultName}. Removed relay data for the previous vault (${replacement.purgedTaskCount} tasks; ${replacement.discardedOperationCount} waiting mobile changes).`,
      );
    }
  }

  private async setStableIdModeWithConfirmation(
    mode: StableIdMode,
  ): Promise<void> {
    if (
      mode === "backfill_and_future" &&
      this.plugin.settings.cloudIdentityMode !== "backfill_and_future"
    ) {
      const count = await this.plugin.countStableIdBackfillCandidates();
      if (count > 0 && !(await confirmBackfill(this.plugin, count))) {
        return;
      }
    }
    await this.plugin.setStableIdMode(mode);
  }

  private async useThisDeviceAsPublisherWithConfirmation(): Promise<void> {
    if (!(await confirmPublisherTakeover(this.plugin))) {
      return;
    }
    await this.plugin.useThisDeviceAsPublisher();
  }

  private async disableCloudSyncWithConfirmation(): Promise<void> {
    if (!(await confirmDisable(this.plugin))) {
      return;
    }
    await this.plugin.disableCloudSync();
  }
}

function isDefinitionVisible(definition: {
  visible?: boolean | (() => boolean);
}): boolean {
  return typeof definition.visible === "function"
    ? definition.visible()
    : definition.visible !== false;
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

async function confirmVaultReplacement(
  plugin: DainvoTaskManagerPlugin,
  activeVault: CloudPublisherVault,
  nextVaultName: string,
): Promise<boolean> {
  const publisher =
    activeVault.publisher_kind === "obsidian_plugin"
      ? "Dainvo Task Manager plugin"
      : "Dainvo desktop";
  const lastPublished = activeVault.last_published_at ?? "not yet published";
  return confirmAction(
    plugin,
    "Replace the mobile Obsidian vault?",
    `${activeVault.vault_name} is currently synced for this Dainvo account (publisher: ${publisher}; last published: ${lastPublished}; vault ID: …${cloudIdSuffix(activeVault.id)}). Replace it with ${nextVaultName}? Relay tasks and waiting mobile changes for the current vault will be removed. Its Markdown and files stay untouched.`,
    "Replace vault",
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
        setDestructiveButton(button.setButtonText(this.confirmLabel))
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

function cloudIdSuffix(cloudVaultId: string): string {
  return cloudVaultId.replaceAll("-", "").slice(-8);
}
