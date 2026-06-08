import { Notice, Plugin, TFile } from "obsidian";
import {
  appHasDailyNotesPluginLoaded,
  getDailyNoteSettings,
} from "obsidian-daily-notes-interface";

import { DainvoBridgeClient } from "./bridgeClient";
import {
  emptyDailyNoteSettings,
  parseDailyNotesConfig,
  parsePeriodicNotesDailyConfig,
  resolveDailyNoteSettingsFromSources,
  type DetectedDailyNoteSettings,
} from "./dailyNotesSettings";
import { DainvoTaskManagerSettingTab } from "./settings";
import { buildSnapshotPayload } from "./snapshot";
import {
  DEFAULT_SETTINGS,
  type DailyNoteSettings,
  type DainvoPluginSettings,
} from "./types";
import { resolveVaultIdentity } from "./vaultIdentity";
import { applyOperationToVault, DainvoWriteBackConflict } from "./writeBack";

const SNAPSHOT_DEBOUNCE_MS = 1_500;
const SNAPSHOT_RETRY_MS = 30_000;
const OPERATION_POLL_MS = 15_000;

export default class DainvoTaskManagerPlugin extends Plugin {
  settings: DainvoPluginSettings = { ...DEFAULT_SETTINGS };
  private bridgeClient = new DainvoBridgeClient(() => this.settings);
  private snapshotTimer: number | null = null;
  private isSnapshotInFlight = false;
  private isOperationPollInFlight = false;
  private hasPendingSnapshotRetry = false;
  private hasQueuedSnapshot = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.ensureVaultIdentity();
    await this.resolveDailyNoteSettings().catch(() => undefined);

    this.addSettingTab(new DainvoTaskManagerSettingTab(this));
    this.addCommand({
      id: "sync-vault-tasks-now",
      name: "Sync vault tasks now",
      callback: () => {
        void this.pushSnapshotNow().catch((error: unknown) => {
          new Notice(formatError(error));
        });
      },
    });
    this.addCommand({
      id: "poll-dainvo-write-back",
      name: "Poll Dainvo write-back",
      callback: () => {
        void this.pollPendingOperations().catch((error: unknown) => {
          new Notice(formatError(error));
        });
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      this.scheduleSnapshot();
    });
    this.registerInterval(
      window.setInterval(() => {
        void this.pollPendingOperations().catch(() => undefined);
      }, OPERATION_POLL_MS),
    );
    this.registerInterval(
      window.setInterval(() => {
        if (this.hasPendingSnapshotRetry) {
          this.scheduleSnapshot();
        }
      }, SNAPSHOT_RETRY_MS),
    );
  }

  onunload(): void {
    if (this.snapshotTimer !== null) {
      window.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...((await this.loadData()) as Partial<DainvoPluginSettings> | null),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async pairWithDainvo(): Promise<void> {
    await this.ensureVaultIdentity();
    const result = await this.bridgeClient.pair({
      pairingCode: this.settings.pairingCode.trim(),
      vaultId: this.settings.vaultId,
      vaultName: this.settings.vaultName,
      vaultPath: this.settings.vaultPath,
      pluginVersion: this.manifest.version,
      dailyNoteSettings: await this.resolveDailyNoteSettings(),
    });

    this.settings.accountId = result.accountId;
    this.settings.bearerToken = result.token;
    this.settings.bridgeBaseUrl = result.baseUrl;
    this.settings.lastStatus = "Paired";
    await this.saveSettings();
    await this.pushSnapshotNow();
  }

  scheduleSnapshot(): void {
    if (!this.settings.bearerToken || !this.settings.bridgeBaseUrl) {
      return;
    }

    if (this.snapshotTimer !== null) {
      window.clearTimeout(this.snapshotTimer);
    }

    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = null;
      void this.pushSnapshotNow().catch((error: unknown) => {
        this.settings.lastStatus = formatError(error);
        void this.saveSettings();
      });
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  async pushSnapshotNow(): Promise<void> {
    if (this.isSnapshotInFlight) {
      this.hasQueuedSnapshot = true;
      return;
    }

    this.isSnapshotInFlight = true;
    try {
      await this.ensureVaultIdentity();
      const payload = await buildSnapshotPayload({
        vault: this.app.vault,
        settings: this.settings,
        dailyNoteSettings: await this.resolveDailyNoteSettings(),
      });
      await this.bridgeClient.postSnapshot(payload);
      this.settings.lastSnapshotAt = payload.exportedAt;
      this.settings.lastStatus = "Snapshot sent";
      this.hasPendingSnapshotRetry = false;
      await this.saveSettings();
    } catch (error) {
      this.hasPendingSnapshotRetry = true;
      this.settings.lastStatus = formatError(error);
      await this.saveSettings();
      throw error;
    } finally {
      this.isSnapshotInFlight = false;

      if (this.hasQueuedSnapshot) {
        this.hasQueuedSnapshot = false;
        this.scheduleSnapshot();
      }
    }
  }

  async pollPendingOperations(): Promise<void> {
    if (
      this.isOperationPollInFlight ||
      !this.settings.bearerToken ||
      !this.settings.bridgeBaseUrl
    ) {
      return;
    }

    this.isOperationPollInFlight = true;
    try {
      const operations = await this.bridgeClient.listOperations();

      for (const operation of operations) {
        try {
          await applyOperationToVault(this.app.vault, operation);
          await this.bridgeClient.ackOperation(operation.id, {
            status: "succeeded",
          });
        } catch (error) {
          await this.bridgeClient.ackOperation(operation.id, {
            status:
              error instanceof DainvoWriteBackConflict ? "conflict" : "failed",
            error: formatError(error),
          });
        }
      }

      if (operations.length > 0) {
        this.scheduleSnapshot();
      }
      this.settings.lastStatus = `Polled ${operations.length} operation(s)`;
      await this.saveSettings();
    } catch (error) {
      this.settings.lastStatus = formatError(error);
      await this.saveSettings();
      throw error;
    } finally {
      this.isOperationPollInFlight = false;
    }
  }

  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleSnapshot();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleSnapshot();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleSnapshot();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleSnapshot();
        }
      }),
    );
  }

  async resolveDailyNoteSettings(): Promise<DailyNoteSettings> {
    const detected = detectObsidianDailyNoteSettings();
    const coreConfig = await this.readCoreDailyNoteSettings();
    const dailyNotesEnabled = detectObsidianDailyNoteCapability();

    const resolved = resolveDailyNoteSettingsFromSources({
      settings: this.settings,
      detected,
      coreConfig,
      dailyNotesEnabled,
    });

    if (!this.settings.dailyNoteSettingsOverrideEnabled) {
      await this.cacheAutomaticDailyNoteSettings(resolved);
    }

    return resolved;
  }

  async copyCurrentDailyNoteSettingsToOverrides(): Promise<void> {
    const detected = detectObsidianDailyNoteSettings();
    const coreConfig = await this.readCoreDailyNoteSettings();
    const automaticSettings = resolveDailyNoteSettingsFromSources({
      settings: {
        ...this.settings,
        dailyNoteDateFormat: "",
        dailyNoteFolder: "",
        dailyNoteTemplatePath: "",
        dailyNoteSettingsOverrideEnabled: false,
      },
      detected,
      coreConfig,
      dailyNotesEnabled: true,
    });

    this.settings.dailyNoteDateFormat = automaticSettings.dateFormat;
    this.settings.dailyNoteFolder = automaticSettings.folder;
    this.settings.dailyNoteTemplatePath = automaticSettings.templatePath ?? "";
    this.settings.dailyNoteSettingsOverrideEnabled = true;
    await this.saveSettings();
  }

  private async cacheAutomaticDailyNoteSettings(
    settings: DailyNoteSettings,
  ): Promise<void> {
    const nextTemplatePath = settings.templatePath ?? "";

    if (
      this.settings.dailyNoteDateFormat === settings.dateFormat &&
      this.settings.dailyNoteFolder === settings.folder &&
      this.settings.dailyNoteTemplatePath === nextTemplatePath
    ) {
      return;
    }

    this.settings.dailyNoteDateFormat = settings.dateFormat;
    this.settings.dailyNoteFolder = settings.folder;
    this.settings.dailyNoteTemplatePath = nextTemplatePath;
    await this.saveSettings();
  }

  private async readCoreDailyNoteSettings(): Promise<DetectedDailyNoteSettings> {
    const configDir = this.app.vault.configDir || ".obsidian";
    const normalizedConfigDir = configDir.replace(/\/+$/, "");
    const periodicConfigPath = `${normalizedConfigDir}/plugins/periodic-notes/data.json`;
    const dailyNotesConfigPath = `${normalizedConfigDir}/daily-notes.json`;

    const periodicConfig = await this.readStoredDailyNoteSettings(
      periodicConfigPath,
      parsePeriodicNotesDailyConfig,
    );

    if (hasDetectedDailyNoteSettings(periodicConfig)) {
      return periodicConfig;
    }

    return this.readStoredDailyNoteSettings(
      dailyNotesConfigPath,
      parseDailyNotesConfig,
    );
  }

  private async readStoredDailyNoteSettings(
    configPath: string,
    parser: (value: unknown) => DetectedDailyNoteSettings,
  ): Promise<DetectedDailyNoteSettings> {
    try {
      const content = await this.app.vault.adapter.read(configPath);
      return parser(JSON.parse(content));
    } catch {
      return emptyDailyNoteSettings();
    }
  }

  private async ensureVaultIdentity(): Promise<void> {
    const identity = resolveVaultIdentity({
      adapter: this.app.vault.adapter,
      vaultName: this.app.vault.getName(),
      currentVaultId: this.settings.vaultId,
    });

    this.settings.vaultId = identity.vaultId;
    this.settings.vaultName = identity.vaultName;
    this.settings.vaultPath = identity.vaultPath;
    await this.saveSettings();
  }
}

function detectObsidianDailyNoteSettings(): DetectedDailyNoteSettings {
  try {
    return parseDailyNotesConfig(getDailyNoteSettings());
  } catch {
    return emptyDailyNoteSettings();
  }
}

function detectObsidianDailyNoteCapability(): boolean {
  try {
    return appHasDailyNotesPluginLoaded();
  } catch {
    return false;
  }
}

function hasDetectedDailyNoteSettings(
  settings: DetectedDailyNoteSettings,
): boolean {
  return Boolean(
    settings.dateFormat || settings.folder || settings.templatePath,
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
