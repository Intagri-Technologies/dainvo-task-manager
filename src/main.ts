import { Notice, Plugin, TFile } from 'obsidian';

import { DainvoBridgeClient } from './bridgeClient';
import { parseMarkdownTasks } from './parser';
import { DainvoTaskManagerSettingTab } from './settings';
import {
  DEFAULT_SETTINGS,
  type DainvoPluginSettings,
  type ObsidianSnapshotPayload
} from './types';
import {
  applyOperationToVault,
  DainvoWriteBackConflict
} from './writeBack';

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

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.ensureVaultIdentity();

    this.addSettingTab(new DainvoTaskManagerSettingTab(this));
    this.addCommand({
      id: 'sync-vault-tasks-now',
      name: 'Sync vault tasks now',
      callback: () => {
        void this.pushSnapshotNow().catch((error: unknown) => {
          new Notice(formatError(error));
        });
      }
    });
    this.addCommand({
      id: 'poll-dainvo-write-back',
      name: 'Poll Dainvo write-back',
      callback: () => {
        void this.pollPendingOperations().catch((error: unknown) => {
          new Notice(formatError(error));
        });
      }
    });

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      this.scheduleSnapshot();
    });
    this.registerInterval(
      window.setInterval(() => {
        void this.pollPendingOperations().catch(() => undefined);
      }, OPERATION_POLL_MS)
    );
    this.registerInterval(
      window.setInterval(() => {
        if (this.hasPendingSnapshotRetry) {
          this.scheduleSnapshot();
        }
      }, SNAPSHOT_RETRY_MS)
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
      ...((await this.loadData()) as Partial<DainvoPluginSettings> | null)
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
      pluginVersion: this.manifest.version
    });

    this.settings.accountId = result.accountId;
    this.settings.bearerToken = result.token;
    this.settings.bridgeBaseUrl = result.baseUrl;
    this.settings.lastStatus = 'Paired';
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
      return;
    }

    this.isSnapshotInFlight = true;
    try {
      await this.ensureVaultIdentity();
      const payload = await this.buildSnapshotPayload();
      await this.bridgeClient.postSnapshot(payload);
      this.settings.lastSnapshotAt = payload.exportedAt;
      this.settings.lastStatus = 'Snapshot sent';
      this.hasPendingSnapshotRetry = false;
      await this.saveSettings();
    } catch (error) {
      this.hasPendingSnapshotRetry = true;
      this.settings.lastStatus = formatError(error);
      await this.saveSettings();
      throw error;
    } finally {
      this.isSnapshotInFlight = false;
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
            status: 'succeeded'
          });
        } catch (error) {
          await this.bridgeClient.ackOperation(operation.id, {
            status:
              error instanceof DainvoWriteBackConflict
                ? 'conflict'
                : 'failed',
            error: formatError(error)
          });
        }
      }

      if (operations.length > 0) {
        this.scheduleSnapshot();
      }
      this.settings.lastStatus = `Polled ${operations.length} operation(s)`;
      await this.saveSettings();
    } finally {
      this.isOperationPollInFlight = false;
    }
  }

  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scheduleSnapshot();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scheduleSnapshot();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scheduleSnapshot();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scheduleSnapshot();
        }
      })
    );
  }

  private async buildSnapshotPayload(): Promise<ObsidianSnapshotPayload> {
    const tasks = [];
    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path));

    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      tasks.push(
        ...parseMarkdownTasks({
          vaultId: this.settings.vaultId,
          vaultName: this.settings.vaultName,
          notePath: file.path,
          content
        })
      );
    }

    return {
      schemaVersion: 1,
      vaultId: this.settings.vaultId,
      vaultName: this.settings.vaultName,
      vaultPath: this.settings.vaultPath,
      exportedAt: new Date().toISOString(),
      tasks
    };
  }

  private async ensureVaultIdentity(): Promise<void> {
    const vaultName = this.app.vault.getName();
    const vaultPath = getVaultBasePath(this.app.vault.adapter);

    if (!this.settings.vaultId) {
      this.settings.vaultId = createVaultId(vaultName, vaultPath);
    }

    this.settings.vaultName = vaultName;
    this.settings.vaultPath = vaultPath;
    await this.saveSettings();
  }
}

function getVaultBasePath(adapter: unknown): string {
  if (
    adapter &&
    typeof adapter === 'object' &&
    'getBasePath' in adapter &&
    typeof adapter.getBasePath === 'function'
  ) {
    return String(adapter.getBasePath());
  }

  throw new Error('Dainvo Task Manager requires Obsidian desktop vault access.');
}

function createVaultId(vaultName: string, vaultPath: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `obsidian-${slug(vaultName)}-${slug(vaultPath).slice(0, 24)}-${random}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
