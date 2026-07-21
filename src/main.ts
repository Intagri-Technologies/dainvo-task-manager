import {
  MarkdownView,
  normalizePath,
  Notice,
  Platform,
  Plugin,
  TFile,
} from "obsidian";
import {
  appHasDailyNotesPluginLoaded,
  getDailyNoteSettings,
} from "obsidian-daily-notes-interface";

import { DainvoBridgeClient } from "./bridgeClient";
import { DainvoCloudClient } from "./cloudClient";
import { ObsidianCloudSyncCoordinator } from "./cloudSync";
import {
  emptyDailyNoteSettings,
  parseDailyNotesConfig,
  parsePeriodicNotesDailyConfig,
  resolveDailyNoteSettingsFromSources,
  type DetectedDailyNoteSettings,
} from "./dailyNotesSettings";
import { DainvoOAuthClient } from "./oauthClient";
import { getDainvoCloudConfig } from "./runtimeConfig";
import { DainvoSecureStore } from "./secureStore";
import { DainvoTaskManagerSettingTab } from "./settings";
import { buildSnapshotPayload } from "./snapshot";
import { StableIdCoordinator } from "./stableIds";
import { dainvoStableIdVisibilityExtension } from "./stableIdVisibility";
import {
  DEFAULT_SETTINGS,
  type CloudPublisherVault,
  type CloudVaultReplacementSummary,
  type DailyNoteSettings,
  type DainvoPluginSettings,
  type StableIdMode,
} from "./types";
import { resolveVaultIdentity } from "./vaultIdentity";
import { applyOperationToVault, DainvoWriteBackConflict } from "./writeBack";

const SNAPSHOT_DEBOUNCE_MS = 1_500;
const SNAPSHOT_RETRY_MS = 30_000;
const LOCAL_OPERATION_POLL_MS = 15_000;
const CLOUD_SYNC_POLL_MS = 30_000;

export default class DainvoTaskManagerPlugin extends Plugin {
  settings: DainvoPluginSettings = { ...DEFAULT_SETTINGS };
  private secureStore!: DainvoSecureStore;
  private bridgeClient!: DainvoBridgeClient;
  private oauthClient!: DainvoOAuthClient;
  private cloudCoordinator!: ObsidianCloudSyncCoordinator;
  private stableIds!: StableIdCoordinator;
  private snapshotTimer: number | null = null;
  private cloudSyncTimer: number | null = null;
  private isSnapshotInFlight = false;
  private isOperationPollInFlight = false;
  private hasPendingSnapshotRetry = false;
  private hasQueuedSnapshot = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.secureStore = new DainvoSecureStore(this.app.secretStorage);
    await this.ensureVaultIdentity();
    await this.migrateLegacySecrets();

    this.bridgeClient = new DainvoBridgeClient(
      () => this.settings,
      () => this.getBridgeToken(),
    );
    const cloudConfig = getDainvoCloudConfig();
    this.oauthClient = new DainvoOAuthClient(cloudConfig, this.secureStore);
    const cloudClient = new DainvoCloudClient(cloudConfig, this.oauthClient);
    this.stableIds = new StableIdCoordinator(
      this.app.vault,
      () => this.settings,
      () => this.saveSettings(),
      (candidate) => this.isTaskLineBeingEdited(candidate),
    );
    this.cloudCoordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: this.app.vault,
        getSettings: () => this.settings,
        saveSettings: () => this.saveSettings(),
        getDeviceId: () => this.secureStore.getOrCreateDeviceId(),
        ensureBridgeIdentityAliasSupport: () =>
          this.ensureBridgeIdentityAliasSupport(),
      },
      this.oauthClient,
      cloudClient,
      this.stableIds,
    );
    this.registerEditorExtension(dainvoStableIdVisibilityExtension);

    await this.resolveDailyNoteSettings().catch(() => undefined);
    this.addSettingTab(new DainvoTaskManagerSettingTab(this));
    this.registerObsidianProtocolHandler("dainvo-auth", (params) => {
      void this.handleCloudAuthCallback(params).catch((error: unknown) => {
        new Notice(formatError(error));
      });
    });

    this.addCommand({
      id: "sync-mobile-tasks-now",
      name: "Sync tasks to Dainvo mobile now",
      callback: () => {
        void this.syncCloudNow().catch((error: unknown) => {
          new Notice(formatError(error));
        });
      },
    });

    if (Platform.isDesktopApp) {
      this.registerDesktopCommands();
    }

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      if (Platform.isDesktopApp) {
        this.scheduleSnapshot();
      }
      if (this.settings.cloudSyncEnabled) {
        this.scheduleCloudSync();
      }
    });

    if (Platform.isDesktopApp) {
      this.registerInterval(
        window.setInterval(() => {
          void this.pollPendingOperations().catch(() => undefined);
        }, LOCAL_OPERATION_POLL_MS),
      );
      this.registerInterval(
        window.setInterval(() => {
          if (this.hasPendingSnapshotRetry) {
            this.scheduleSnapshot();
          }
        }, SNAPSHOT_RETRY_MS),
      );
    }

    this.registerInterval(
      window.setInterval(() => {
        if (
          this.settings.cloudSyncEnabled &&
          (Platform.isDesktopApp || document.visibilityState === "visible") &&
          (this.settings.cloudStatus !== "retryable_error" ||
            this.cloudCoordinator.shouldRetryNow())
        ) {
          void this.cloudCoordinator.requestSync().catch(() => undefined);
        }
      }, CLOUD_SYNC_POLL_MS),
    );
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.scheduleCloudSync();
      }
    });
  }

  onunload(): void {
    if (this.snapshotTimer !== null) {
      window.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.cloudSyncTimer !== null) {
      window.clearTimeout(this.cloudSyncTimer);
      this.cloudSyncTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...((await this.loadData()) as Partial<DainvoPluginSettings> | null),
    };
  }

  async saveSettings(): Promise<void> {
    // The field remains only to migrate 1.0.x data. Never write a bearer token
    // back into data.json after SecretStorage is available.
    this.settings.bearerToken = "";
    await this.saveData(this.settings);
  }

  isDesktopBridgeAvailable(): boolean {
    return Platform.isDesktopApp;
  }

  hasDesktopBridgePairing(): boolean {
    return Platform.isDesktopApp && Boolean(this.getBridgeToken());
  }

  isCloudSignedIn(): boolean {
    return Boolean(this.secureStore?.getCloudSession());
  }

  cloudSignedInUserId(): string {
    return this.secureStore?.getCloudSession()?.userId ?? "";
  }

  cloudSignedInAccountLabel(): string {
    const session = this.secureStore?.getCloudSession();
    if (!session) {
      return "";
    }
    return session.email?.trim() || `Account ${session.userId.slice(0, 8)}`;
  }

  async pairWithDainvo(): Promise<void> {
    if (!Platform.isDesktopApp) {
      throw new Error("The local Dainvo bridge is available on desktop only.");
    }
    await this.ensureVaultIdentity();
    const result = await this.bridgeClient.pair({
      pairingCode: this.settings.pairingCode.trim(),
      vaultId: this.settings.vaultId,
      vaultName: this.settings.vaultName,
      vaultPath: this.settings.vaultPath,
      vaultConfigDir: this.settings.vaultConfigDir,
      pluginVersion: this.manifest.version,
      dailyNoteSettings: await this.resolveDailyNoteSettings(),
    });

    this.settings.accountId = result.accountId;
    this.settings.bridgeBaseUrl = result.baseUrl;
    this.settings.pairingCode = "";
    this.settings.lastStatus = "Paired";
    this.secureStore.setBridgeToken(this.settings.vaultId, result.token);
    await this.saveSettings();
    await this.pushSnapshotNow();
  }

  async unpairDesktopBridge(): Promise<void> {
    this.secureStore.setBridgeToken(this.settings.vaultId, null);
    this.settings.accountId = "";
    this.settings.bridgeBaseUrl = "";
    this.settings.pairingCode = "";
    this.settings.lastStatus = "Not paired";
    await this.saveSettings();
  }

  async beginCloudSignIn(): Promise<void> {
    this.settings.cloudStatus = "signing_in";
    this.settings.cloudLastErrorCode = "";
    await this.saveSettings();
    const authorizationUrl = await this.oauthClient.createAuthorizationUrl();
    window.open(authorizationUrl, "_blank", "noopener,noreferrer");
  }

  async signOutCloud(): Promise<void> {
    await this.oauthClient.signOut();
    this.settings.cloudStatus = this.settings.cloudSyncEnabled
      ? "paused_signed_out"
      : "disabled";
    await this.saveSettings();
  }

  async enableCloudSync(
    replaceVaultId?: string,
  ): Promise<CloudVaultReplacementSummary | null> {
    this.settings.cloudSyncEnabled = true;
    this.settings.cloudVaultKey = this.settings.vaultId;
    this.settings.cloudStatus = this.secureStore.getCloudSession()
      ? "publishing"
      : "paused_signed_out";
    await this.saveSettings();
    return this.cloudCoordinator.requestSync({ replaceVaultId });
  }

  async disableCloudSync(): Promise<void> {
    await this.cloudCoordinator.disableAndPurge();
  }

  async syncCloudNow(): Promise<void> {
    if (!this.settings.cloudSyncEnabled) {
      throw new Error("Enable Dainvo mobile task sync first.");
    }
    await this.cloudCoordinator.requestSync();
  }

  async useThisDeviceAsPublisher(): Promise<void> {
    if (!this.settings.cloudSyncEnabled) {
      this.settings.cloudSyncEnabled = true;
      await this.saveSettings();
    }
    await this.cloudCoordinator.requestSync({ takeover: true });
  }

  async relinkCloudAccount(): Promise<void> {
    await this.cloudCoordinator.relinkToCurrentAccount();
  }

  listCloudVaults(): Promise<CloudPublisherVault[]> {
    return this.cloudCoordinator.listCloudVaults();
  }

  getVaultReplacementCandidate(): Promise<CloudPublisherVault | null> {
    return this.cloudCoordinator.getVaultReplacementCandidate();
  }

  refreshCloudAccessStatus(): Promise<{
    allowed: boolean;
    planName: string;
    reason: string;
  }> {
    return this.cloudCoordinator.refreshAccessStatus();
  }

  countStableIdBackfillCandidates(): Promise<number> {
    return this.stableIds.countBackfillCandidates();
  }

  async setStableIdMode(mode: StableIdMode): Promise<void> {
    this.settings.cloudIdentityMode = mode;
    await this.saveSettings();
    if (this.settings.cloudSyncEnabled) {
      await this.cloudCoordinator.requestSync();
    }
  }

  scheduleSnapshot(): void {
    if (
      !Platform.isDesktopApp ||
      !this.getBridgeToken() ||
      !this.settings.bridgeBaseUrl
    ) {
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

  scheduleCloudSync(): void {
    if (!this.settings.cloudSyncEnabled) {
      return;
    }
    if (Platform.isMobileApp && document.visibilityState !== "visible") {
      return;
    }
    if (this.cloudSyncTimer !== null) {
      window.clearTimeout(this.cloudSyncTimer);
    }
    this.cloudSyncTimer = window.setTimeout(() => {
      this.cloudSyncTimer = null;
      void this.cloudCoordinator.requestSync().catch(() => undefined);
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  async pushSnapshotNow(): Promise<void> {
    if (!Platform.isDesktopApp) {
      throw new Error("The local Dainvo bridge is available on desktop only.");
    }
    if (this.settings.stableIdJournal) {
      this.hasPendingSnapshotRetry = true;
      throw new Error(
        "Stable task ID migration is still in progress. The desktop snapshot will retry after it finishes.",
      );
    }
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
      for (const [blockId, alias] of Object.entries(
        this.settings.identityAliases,
      )) {
        if (alias.bridgePending) {
          alias.bridgePending = false;
          if (!alias.cloudPending) {
            delete this.settings.identityAliases[blockId];
          }
        }
      }
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
      !Platform.isDesktopApp ||
      this.isOperationPollInFlight ||
      !this.getBridgeToken() ||
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
        this.scheduleCloudSync();
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

  private registerDesktopCommands(): void {
    this.addCommand({
      id: "sync-vault-tasks-now",
      name: "Sync vault tasks to Dainvo desktop now",
      callback: () => {
        void this.pushSnapshotNow().catch((error: unknown) => {
          new Notice(formatError(error));
        });
      },
    });
    this.addCommand({
      id: "poll-dainvo-write-back",
      name: "Poll Dainvo desktop write-back",
      callback: () => {
        void this.pollPendingOperations().catch((error: unknown) => {
          new Notice(formatError(error));
        });
      },
    });
  }

  private async handleCloudAuthCallback(
    params: Record<string, string>,
  ): Promise<void> {
    const session = await this.oauthClient.completeAuthorization(params);
    if (
      this.settings.cloudOwnerUserId &&
      this.settings.cloudOwnerUserId !== session.userId
    ) {
      this.settings.cloudStatus = "paused_account";
    } else {
      this.settings.cloudOwnerUserId ||= session.userId;
      this.settings.cloudStatus = this.settings.cloudSyncEnabled
        ? "publishing"
        : "disabled";
    }
    await this.saveSettings();
    new Notice(`Signed in to Dainvo as ${this.cloudSignedInAccountLabel()}.`);
    if (this.settings.cloudSyncEnabled) {
      await this.cloudCoordinator.requestSync();
    }
  }

  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.cloudCoordinator.markFileDirty(file.path);
          this.scheduleSnapshot();
          this.scheduleCloudSync();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.cloudCoordinator.markFileDirty(file.path);
          this.scheduleSnapshot();
          this.scheduleCloudSync();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.cloudCoordinator.markFileDirty(file.path);
          this.scheduleSnapshot();
          this.scheduleCloudSync();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.cloudCoordinator.markFileDirty(oldPath);
          this.cloudCoordinator.markFileDirty(file.path);
          this.scheduleSnapshot();
          this.scheduleCloudSync();
        }
      }),
    );
  }

  private isTaskLineBeingEdited(candidate: {
    notePath: string;
    lineNumber: number;
  }): boolean {
    // Vault.process() edits are external to the editor transaction. Appending
    // at the caret can leave the caret before the suffix, so Enter moves that
    // suffix onto the continued checkbox line.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (
      !view?.file ||
      view.getMode() !== "source" ||
      normalizePath(view.file.path) !== normalizePath(candidate.notePath)
    ) {
      return false;
    }

    const candidateLine = candidate.lineNumber - 1;
    return view.editor.listSelections().some(({ anchor, head }) => {
      const firstLine = Math.min(anchor.line, head.line);
      const lastLine = Math.max(anchor.line, head.line);
      return candidateLine >= firstLine && candidateLine <= lastLine;
    });
  }

  private async ensureBridgeIdentityAliasSupport(): Promise<void> {
    if (!Platform.isDesktopApp || !this.getBridgeToken()) {
      return;
    }
    const status = await this.bridgeClient.getStatus();
    if (!status.capabilities?.includes("task_identity_alias_v1")) {
      throw new Error(
        "Update Dainvo desktop before backfilling stable IDs, or disconnect the local desktop bridge.",
      );
    }
  }

  private getBridgeToken(): string {
    if (!this.secureStore || !this.settings.vaultId) {
      return "";
    }
    return this.secureStore.getBridgeToken(this.settings.vaultId);
  }

  private async migrateLegacySecrets(): Promise<void> {
    if (
      this.secureStore.migrateLegacyBridgeToken(
        this.settings.vaultId,
        this.settings.bearerToken,
      )
    ) {
      this.settings.bearerToken = "";
      await this.saveSettings();
    }
    this.secureStore.getOrCreateDeviceId();
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
    const normalizedConfigDir = this.app.vault.configDir.replace(/\/+$/, "");
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
    const previousCloudVaultKey = this.settings.cloudVaultKey;
    const identity = resolveVaultIdentity({
      adapter: this.app.vault.adapter,
      vaultName: this.app.vault.getName(),
      currentVaultId: this.settings.vaultId,
    });
    this.settings.vaultId = identity.vaultId;
    this.settings.vaultName = identity.vaultName;
    this.settings.vaultPath = identity.vaultPath;
    this.settings.vaultConfigDir = this.app.vault.configDir;
    if (previousCloudVaultKey !== identity.vaultId) {
      // Legacy plugin builds could bind this physical vault to an arbitrary
      // cloud mapping. A lost/reset vault ID is also a new logical vault.
      // Clear that binding and require an explicit account-wide replacement;
      // never infer identity from the display name or filesystem path.
      this.settings.cloudVaultId = "";
      this.settings.cloudPublishedDigests = {};
      this.settings.cloudOperationJournal = {};
      this.settings.cloudOperationBacklog = 0;
      this.settings.cloudLastPublishedAt = "";
      this.settings.cloudLastFullSyncAt = "";
      this.settings.cloudRetryAttempt = 0;
      this.settings.cloudRetryAt = "";
      this.settings.cloudLastErrorCode = this.settings.cloudSyncEnabled
        ? "obsidian_vault_limit_reached"
        : "";
      if (this.settings.cloudSyncEnabled) {
        this.settings.cloudStatus = "paused_vault_replacement";
      }
    }
    this.settings.cloudVaultKey = identity.vaultId;
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
