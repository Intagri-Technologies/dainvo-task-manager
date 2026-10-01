import {
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  SettingGroup,
  type ButtonComponent,
  type SettingDefinitionItem,
  type SettingDefinitionPage,
} from "obsidian";

import type DainvoTaskManagerPlugin from "./main";
import {
  buildDainvoSettingDefinitions,
  buildDesktopPairingDefinitions,
  buildMobileSyncOptions,
  type DainvoSettingsActions,
} from "./settingsDefinitions";
import type { CloudPublisherVault, StableIdMode } from "./types";

export class DainvoTaskManagerSettingTab extends PluginSettingTab {
  private legacyPageNames: string[] = [];

  constructor(private readonly plugin: DainvoTaskManagerPlugin) {
    super(plugin.app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return buildDainvoSettingDefinitions(this.plugin, this.settingActions());
  }

  private settingActions(
    refresh = () => this.refreshDeclarativeSettings(),
  ): DainvoSettingsActions {
    return {
      refresh,
      openDesktopPairing: () => this.openSettingsOptions(
        "Desktop pairing",
        (actions) => [buildDesktopPairingDefinitions(this.plugin, actions)],
      ),
      openMobileSyncOptions: () => this.openSettingsOptions(
        "Mobile sync options",
        (actions) => buildMobileSyncOptions(this.plugin, actions),
      ),
      setStableIdMode: (mode) => this.setStableIdModeWithConfirmation(mode),
      enableCloudSync: () => this.enableCloudSyncWithConfirmation(),
      useThisDeviceAsPublisher: () =>
        this.useThisDeviceAsPublisherWithConfirmation(),
      disableCloudSync: () => this.disableCloudSyncWithConfirmation(),
    };
  }

  private openSettingsOptions(
    title: string,
    definitions: (actions: DainvoSettingsActions) => SettingDefinitionItem[],
  ): void {
    const modal = new SettingsOptionsModal(
      this.plugin,
      title,
      () => definitions(this.settingActions(() => modal.render())),
      () => this.refreshDeclarativeSettings(),
    );
    modal.open();
    modal.contentEl.focus();
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
    this.legacyPageNames = [];
    this.renderLegacyDefinitions();
  }

  private renderLegacyDefinitions(): void {
    const { containerEl } = this;
    containerEl.empty();
    const definitions = this.getSettingDefinitions();
    const page = findSettingsPage(definitions, this.legacyPageNames.at(-1) ?? null);
    if (page) {
      new Setting(containerEl)
        .setName(page.name)
        .setHeading()
        .addButton((button) => button.setButtonText("Back").onClick(() => {
          this.legacyPageNames.pop();
          this.renderLegacyDefinitions();
        }));
    }
    renderSettingGroups(containerEl, page?.items ?? definitions, (name) => {
      this.legacyPageNames.push(name);
      this.renderLegacyDefinitions();
    });
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

class SettingsOptionsModal extends Modal {
  constructor(
    plugin: DainvoTaskManagerPlugin,
    private readonly titleText: string,
    private readonly definitions: () => SettingDefinitionItem[],
    private readonly refreshSettings: () => void,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.render();
    this.contentEl.setAttribute("tabindex", "-1");
    this.contentEl.focus();
  }

  render(): void {
    this.contentEl.empty();
    renderSettingGroups(this.contentEl, this.definitions());
  }

  onClose(): void {
    this.contentEl.empty();
    this.refreshSettings();
  }
}

function renderSettingGroups(
  containerEl: HTMLElement,
  definitions: SettingDefinitionItem[],
  onOpenPage?: (name: string) => void,
): void {
  for (const definition of definitions) {
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
      if (!isDefinitionVisible(item)) {
        continue;
      }
      if ("type" in item && item.type === "page") {
        const setting = new Setting(group.listEl).setName(item.name);
        if (item.desc) setting.setDesc(item.desc);
        setting.addButton((button) => button.setButtonText("Open").onClick(() => {
          onOpenPage?.(item.name);
        }));
        continue;
      }
      if (!("render" in item) || !item.render) continue;
      const setting = new Setting(group.listEl).setName(item.name);
      if (item.desc) {
        setting.setDesc(item.desc);
      }
      item.render(setting, group);
    }
  }
}

function findSettingsPage(
  definitions: SettingDefinitionItem[],
  name: string | null,
): SettingDefinitionPage | undefined {
  if (!name) return undefined;
  for (const definition of definitions) {
    if (!("type" in definition) || !isDefinitionVisible(definition)) continue;
    if (definition.type === "page" && definition.name === name) return definition;
    if (definition.items) {
      const page = findSettingsPage(definition.items, name);
      if (page) return page;
    }
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
