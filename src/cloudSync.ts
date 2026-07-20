import { normalizePath, type TFile, type Vault } from "obsidian";

import { CloudRelayError, type DainvoCloudClient } from "./cloudClient";
import { DainvoOAuthError, type DainvoOAuthClient } from "./oauthClient";
import { buildProviderTaskId, parseMarkdownTasks } from "./parser";
import { sha256 } from "./sha256";
import type { StableIdCoordinator } from "./stableIds";
import type {
  CloudPendingOperation,
  CloudPublisherVault,
  CloudTaskProjection,
  CloudVaultReplacementSummary,
  DainvoPluginSettings,
  ObsidianSnapshotTask,
  PendingMutationOperation,
} from "./types";
import { applyOperationToVault, DainvoWriteBackConflict } from "./writeBack";

const FULL_RECONCILIATION_MS = 6 * 60 * 60 * 1000;
const MAX_ACTIVE_TASKS = 300;
const MAX_COMPLETED_TASKS = 700;
const MIN_RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60_000;

export type CloudSyncHost = {
  vault: Vault;
  getSettings(): DainvoPluginSettings;
  saveSettings(): Promise<void>;
  getDeviceId(): string;
  ensureBridgeIdentityAliasSupport(): Promise<void>;
};

export class ObsidianCloudSyncCoordinator {
  private readonly taskIndex = new Map<string, ObsidianSnapshotTask[]>();
  private readonly dirtyPaths = new Set<string>();
  private currentRun: Promise<CloudVaultReplacementSummary | null> | null =
    null;
  private queued = false;
  private queuedTakeover = false;
  private queuedReplaceVaultId = "";

  constructor(
    private readonly host: CloudSyncHost,
    private readonly oauth: DainvoOAuthClient,
    private readonly cloud: DainvoCloudClient,
    private readonly stableIds: StableIdCoordinator,
  ) {}

  markFileDirty(path: string): void {
    this.dirtyPaths.add(normalizePath(path));
  }

  shouldRetryNow(): boolean {
    const settings = this.host.getSettings();
    return (
      settings.cloudSyncEnabled &&
      settings.cloudStatus === "retryable_error" &&
      (!settings.cloudRetryAt ||
        Date.parse(settings.cloudRetryAt) <= Date.now())
    );
  }

  requestSync(
    input: {
      takeover?: boolean;
      replaceVaultId?: string;
    } = {},
  ): Promise<CloudVaultReplacementSummary | null> {
    if (input.takeover === true && input.replaceVaultId) {
      return Promise.reject(
        new CloudRelayError("invalid_publisher_action", 400, false),
      );
    }
    if (this.currentRun) {
      this.queued = true;
      if (input.replaceVaultId) {
        // Replacing the account-wide vault supersedes any queued takeover;
        // takeover is meaningful only for the same stable vault identity.
        this.queuedReplaceVaultId = input.replaceVaultId;
        this.queuedTakeover = false;
      } else if (!this.queuedReplaceVaultId) {
        this.queuedTakeover ||= input.takeover === true;
      }
      return this.currentRun;
    }

    this.currentRun = this.runCoalesced(
      input.takeover === true,
      input.replaceVaultId ?? "",
    ).finally(() => {
      this.currentRun = null;
    });
    return this.currentRun;
  }

  async listCloudVaults(): Promise<CloudPublisherVault[]> {
    const session = await this.oauth.getValidSession();
    if (!session) {
      return [];
    }
    return this.cloud.listPublisherVaults();
  }

  async getVaultReplacementCandidate(): Promise<CloudPublisherVault | null> {
    const session = await this.oauth.getValidSession();
    if (!session) {
      return null;
    }
    const activeVault = selectActiveCloudVault(
      await this.cloud.listPublisherVaults(),
    );
    return activeVault &&
      activeVault.vault_id !== this.host.getSettings().vaultId
      ? activeVault
      : null;
  }

  async refreshAccessStatus(): Promise<{
    allowed: boolean;
    planName: string;
    reason: string;
  }> {
    const session = await this.oauth.getValidSession();
    if (!session) {
      return { allowed: false, planName: "", reason: "signed_out" };
    }
    const access = await this.cloud.getAccess();
    const settings = this.host.getSettings();
    settings.cloudPlanName = access.plan_name ?? access.plan_slug ?? "";
    settings.cloudEntitled = access.allowed;
    await this.host.saveSettings();
    return {
      allowed: access.allowed,
      planName: settings.cloudPlanName,
      reason: access.reason,
    };
  }

  async disableAndPurge(): Promise<void> {
    const settings = this.host.getSettings();
    pinCloudVaultIdentity(settings);
    settings.cloudSyncEnabled = false;
    settings.cloudStatus = "disable_pending";
    settings.cloudLastErrorCode = "";
    await this.host.saveSettings();

    try {
      const session = await this.oauth.getValidSession();
      if (!session) {
        throw new CloudRelayError("signed_out", 401, false);
      }
      let cloudVaultId = settings.cloudVaultId;
      if (!cloudVaultId) {
        const mapping = (await this.cloud.listPublisherVaults()).find(
          (vault) => vault.vault_id === settings.cloudVaultKey,
        );
        cloudVaultId = mapping?.id ?? "";
      }
      if (cloudVaultId) {
        await this.cloud.disableVault(cloudVaultId);
      }
      clearCloudMapping(settings);
      settings.cloudStatus = "disabled";
      await this.host.saveSettings();
      this.taskIndex.clear();
      this.dirtyPaths.clear();
    } catch (error) {
      settings.cloudStatus = "disable_pending";
      settings.cloudLastErrorCode = safeErrorCode(error);
      await this.host.saveSettings();
      throw error;
    }
  }

  async relinkToCurrentAccount(): Promise<void> {
    const session = await this.oauth.getValidSession();
    if (!session) {
      throw new Error("Sign in before relinking this vault.");
    }
    const settings = this.host.getSettings();
    settings.cloudOwnerUserId = session.userId;
    settings.cloudVaultId = "";
    settings.cloudVaultKey = settings.vaultId;
    settings.cloudPublishedDigests = {};
    settings.cloudOperationJournal = {};
    settings.cloudLastPublishedAt = "";
    settings.cloudLastFullSyncAt = "";
    settings.cloudStatus = "paused_other_publisher";
    await this.host.saveSettings();
  }

  private async runCoalesced(
    initialTakeover: boolean,
    initialReplaceVaultId: string,
  ): Promise<CloudVaultReplacementSummary | null> {
    let takeover = initialTakeover;
    let replaceVaultId = initialReplaceVaultId;
    let replacementSummary: CloudVaultReplacementSummary | null = null;
    do {
      this.queued = false;
      try {
        replacementSummary =
          (await this.runCycle(takeover, replaceVaultId)) ?? replacementSummary;
      } catch (error) {
        await this.recordFailure(error);
        throw error;
      }
      takeover = this.queuedTakeover;
      this.queuedTakeover = false;
      replaceVaultId = this.queuedReplaceVaultId;
      this.queuedReplaceVaultId = "";
    } while (this.queued);
    return replacementSummary;
  }

  private async runCycle(
    takeover: boolean,
    replaceVaultId: string,
  ): Promise<CloudVaultReplacementSummary | null> {
    const settings = this.host.getSettings();
    if (!settings.cloudSyncEnabled) {
      return null;
    }

    const session = await this.oauth.getValidSession();
    if (!session) {
      settings.cloudStatus = "paused_signed_out";
      await this.host.saveSettings();
      return null;
    }
    if (
      settings.cloudOwnerUserId &&
      settings.cloudOwnerUserId !== session.userId
    ) {
      settings.cloudStatus = "paused_account";
      await this.host.saveSettings();
      return null;
    }
    settings.cloudOwnerUserId ||= session.userId;

    const access = await this.cloud.getAccess();
    settings.cloudPlanName = access.plan_name ?? access.plan_slug ?? "";
    settings.cloudEntitled = access.allowed;
    if (!access.allowed) {
      settings.cloudStatus = "paused_plan";
      settings.cloudLastErrorCode = access.reason;
      await this.host.saveSettings();
      return null;
    }

    const deviceId = this.host.getDeviceId();
    pinCloudVaultIdentity(settings);
    const vaultKey = settings.vaultId;
    const mappings = await this.cloud.listPublisherVaults();
    const activeVault = selectActiveCloudVault(mappings);

    if (activeVault && activeVault.vault_id !== vaultKey) {
      if (!replaceVaultId) {
        settings.cloudVaultId = "";
        settings.cloudStatus = "paused_vault_replacement";
        settings.cloudLastPublishedAt = activeVault.last_published_at ?? "";
        settings.cloudLastErrorCode = "obsidian_vault_limit_reached";
        await this.host.saveSettings();
        return null;
      }
      if (replaceVaultId !== activeVault.id) {
        throw new CloudRelayError("obsidian_active_vault_changed", 409, false);
      }
    } else if (replaceVaultId) {
      throw new CloudRelayError("obsidian_active_vault_changed", 409, false);
    }

    const mapping =
      activeVault?.vault_id === vaultKey ? activeVault : undefined;

    if (
      mapping &&
      !takeover &&
      (mapping.publisher_device_id !== deviceId ||
        mapping.publisher_kind !== "obsidian_plugin")
    ) {
      settings.cloudVaultId = mapping.id;
      settings.cloudStatus = "paused_other_publisher";
      settings.cloudLastPublishedAt = mapping.last_published_at ?? "";
      await this.host.saveSettings();
      return null;
    }

    settings.cloudStatus = "publishing";
    settings.cloudLastErrorCode = "";
    await this.host.saveSettings();
    const publishResult = await this.cloud.publishVault({
      vaultId: vaultKey,
      vaultName: settings.vaultName,
      deviceId,
      identityMode: settings.cloudIdentityMode,
      takeover,
      ...(replaceVaultId ? { replaceVaultId } : {}),
    });
    const publishedVault = publishResult.vault;
    if (!publishedVault?.id) {
      throw new CloudRelayError("obsidian_cloud_vault_id_missing", 500, true);
    }
    let replacementSummary: CloudVaultReplacementSummary | null = null;
    if (replaceVaultId) {
      if (publishResult.replaced_vault_id !== replaceVaultId) {
        throw new CloudRelayError("obsidian_active_vault_changed", 409, false);
      }
      settings.cloudPublishedDigests = {};
      settings.cloudOperationJournal = {};
      settings.cloudOperationBacklog = 0;
      settings.cloudLastFullSyncAt = "";
      replacementSummary = {
        purgedTaskCount: publishResult.purged_task_count ?? 0,
        discardedOperationCount: publishResult.discarded_operation_count ?? 0,
      };
    }
    settings.cloudVaultId = publishedVault.id;

    settings.cloudStatus = "normalizing_ids";
    await this.host.saveSettings();
    const needsNewBackfill =
      settings.cloudIdentityMode === "backfill_and_future" &&
      !settings.stableIdJournal &&
      (await this.stableIds.countBackfillCandidates()) > 0;
    if (needsNewBackfill) {
      await this.host.ensureBridgeIdentityAliasSupport();
    }
    const idResult = await this.stableIds.normalize({
      mode: settings.cloudIdentityMode,
      deviceId,
      resetFutureBaseline:
        takeover && settings.cloudIdentityMode === "future_only",
    });
    if (idResult.changed > 0) {
      this.taskIndex.clear();
    }

    settings.cloudStatus = "publishing";
    await this.host.saveSettings();
    await this.refreshTaskIndex(this.needsFullReconciliation());
    await this.publishCurrentSnapshot(deviceId);

    const operations = await this.cloud.listPendingOperations(
      settings.cloudVaultId,
    );
    for (const operation of operations) {
      settings.cloudOperationJournal[operation.operation_id] ??= {
        operation,
        state: "pending_write",
        receivedAt: new Date().toISOString(),
      };
    }
    settings.cloudOperationBacklog = Object.keys(
      settings.cloudOperationJournal,
    ).length;
    await this.host.saveSettings();

    const operationResult = await this.applyPendingOperations();
    if (operationResult.needsRepublish) {
      this.taskIndex.clear();
      await this.refreshTaskIndex(true);
      await this.publishCurrentSnapshot(deviceId);
    }
    if (operationResult.resolutions.length > 0) {
      await this.cloud.resolveOperations(operationResult.resolutions);
      for (const resolution of operationResult.resolutions) {
        delete settings.cloudOperationJournal[resolution.operation_id];
      }
    }

    settings.cloudOperationBacklog = Object.keys(
      settings.cloudOperationJournal,
    ).length;
    settings.cloudStatus = "published";
    settings.cloudLastPublishedAt = new Date().toISOString();
    settings.cloudRetryAttempt = 0;
    settings.cloudRetryAt = "";
    settings.cloudLastErrorCode = "";
    await this.host.saveSettings();
    return replacementSummary;
  }

  private needsFullReconciliation(): boolean {
    const last = Date.parse(this.host.getSettings().cloudLastFullSyncAt);
    return (
      this.taskIndex.size === 0 ||
      !Number.isFinite(last) ||
      Date.now() - last >= FULL_RECONCILIATION_MS
    );
  }

  private async refreshTaskIndex(forceFull: boolean): Promise<void> {
    const settings = this.host.getSettings();
    const markdownFiles = this.host.vault.getMarkdownFiles();
    const currentPaths = new Set(
      markdownFiles.map((file) => normalizePath(file.path)),
    );

    if (forceFull) {
      this.taskIndex.clear();
      for (const file of markdownFiles) {
        await this.indexFile(file);
      }
      settings.cloudLastFullSyncAt = new Date().toISOString();
      this.dirtyPaths.clear();
      await this.host.saveSettings();
      return;
    }

    for (const path of [...this.taskIndex.keys()]) {
      if (!currentPaths.has(path)) {
        this.taskIndex.delete(path);
      }
    }
    for (const path of this.dirtyPaths) {
      const file = this.host.vault.getAbstractFileByPath(path);
      if (isMarkdownFile(file)) {
        await this.indexFile(file);
      } else {
        this.taskIndex.delete(path);
      }
    }
    this.dirtyPaths.clear();
  }

  private async indexFile(file: TFile): Promise<void> {
    const settings = this.host.getSettings();
    const content = await this.host.vault.cachedRead(file);
    this.taskIndex.set(
      normalizePath(file.path),
      parseMarkdownTasks({
        vaultId: settings.cloudVaultKey,
        vaultName: settings.vaultName,
        notePath: file.path,
        content,
      }),
    );
  }

  private selectedTasks(): ObsidianSnapshotTask[] {
    return selectRelayTasks([...this.taskIndex.values()].flat());
  }

  private taskOwners(): ObsidianSnapshotTask[] {
    return selectRelayTaskOwners([...this.taskIndex.values()].flat());
  }

  private async publishCurrentSnapshot(deviceId: string): Promise<void> {
    const settings = this.host.getSettings();
    const selected = this.selectedTasks();
    const projections = selected.map((task) => this.toProjection(task));
    const nextDigests: Record<string, string> = {};
    const upserts: CloudTaskProjection[] = [];

    for (const projection of projections) {
      const digest = projectionDigest(projection);
      nextDigests[projection.provider_task_id] = digest;
      if (
        settings.cloudPublishedDigests[projection.provider_task_id] !==
          digest ||
        projection.previous_provider_task_id
      ) {
        upserts.push(projection);
      }
    }

    const publishedAt = new Date().toISOString();
    await this.cloud.pushSnapshot({
      cloudVaultId: settings.cloudVaultId,
      deviceId,
      upserts,
      presentProviderTaskIds: projections.map(
        (projection) => projection.provider_task_id,
      ),
      publishedAt,
    });

    settings.cloudPublishedDigests = nextDigests;
    settings.cloudLastPublishedAt = publishedAt;
    for (const task of selected) {
      if (!task.blockId) {
        continue;
      }
      const alias = settings.identityAliases[task.blockId];
      if (alias?.cloudPending) {
        alias.cloudPending = false;
        if (!alias.bridgePending) {
          delete settings.identityAliases[task.blockId];
        }
      }
    }
    await this.host.saveSettings();
  }

  private toProjection(task: ObsidianSnapshotTask): CloudTaskProjection {
    const settings = this.host.getSettings();
    const alias = task.blockId
      ? settings.identityAliases[task.blockId]
      : undefined;
    return {
      provider_task_id: task.providerTaskId,
      ...(alias?.cloudPending
        ? {
            previous_provider_task_id: buildProviderTaskId({
              vaultId: settings.cloudVaultKey,
              notePath: alias.notePath,
              lineNumber: alias.lineNumber,
              blockId: null,
            }),
          }
        : {}),
      title: task.title,
      status: task.status,
      priority: task.priority,
      labels: task.labels,
      due_at: task.dueAt,
      completed_at: task.completedAt,
      note_path: normalizePath(task.notePath),
      note_title: task.noteTitle,
      heading: task.heading,
      open_uri: task.openUri,
    };
  }

  private async applyPendingOperations(): Promise<{
    needsRepublish: boolean;
    resolutions: Array<{
      operation_id: string;
      status: "applied" | "conflict" | "rejected";
      result?: Record<string, unknown>;
    }>;
  }> {
    const settings = this.host.getSettings();
    const resolutions: Array<{
      operation_id: string;
      status: "applied" | "conflict" | "rejected";
      result?: Record<string, unknown>;
    }> = [];
    let needsRepublish = false;
    // Use the same deterministic first-owner/window selection that was
    // published, so a flagged legacy duplicate can never receive write-back.
    const tasks = this.taskOwners();

    for (const entry of Object.values(settings.cloudOperationJournal).sort(
      (left, right) => left.receivedAt.localeCompare(right.receivedAt),
    )) {
      const operation = entry.operation;
      const desiredStatus =
        operation.operation_type === "delete"
          ? null
          : operation.operation_type === "complete"
            ? "completed"
            : "open";

      if (entry.state === "written_pending_publish") {
        needsRepublish = true;
        resolutions.push(appliedResolution(operation));
        continue;
      }

      const task = tasks.find(
        (candidate) => candidate.providerTaskId === operation.provider_task_id,
      );
      if (!task) {
        resolutions.push(
          operation.operation_type === "delete"
            ? appliedResolution(operation, "task_already_absent")
            : {
                operation_id: operation.operation_id,
                status: "rejected",
                result: { reason: "task_missing" },
              },
        );
        continue;
      }
      const disposition = classifyPendingOperation(
        operation,
        task.status,
        desiredStatus,
      );
      if (disposition === "already_applied") {
        resolutions.push(appliedResolution(operation));
        continue;
      }
      if (disposition === "stale_server_version") {
        resolutions.push({
          operation_id: operation.operation_id,
          status: "conflict",
          result: { reason: "stale_server_version" },
        });
        continue;
      }
      if (disposition === "local_status_changed") {
        resolutions.push({
          operation_id: operation.operation_id,
          status: "conflict",
          result: { reason: "local_status_changed" },
        });
        continue;
      }

      const localOperation = toLocalOperation(operation, task, desiredStatus);
      try {
        await applyOperationToVault(this.host.vault, localOperation);
        entry.state = "written_pending_publish";
        settings.cloudOperationJournal[operation.operation_id] = entry;
        needsRepublish = true;
        resolutions.push(appliedResolution(operation));
        await this.host.saveSettings();
      } catch (error) {
        if (error instanceof DainvoWriteBackConflict) {
          resolutions.push({
            operation_id: operation.operation_id,
            status: "conflict",
            result: { reason: "local_task_changed" },
          });
          continue;
        }
        // Filesystem and temporary vault failures remain journaled for retry.
        throw error;
      }
    }
    return { needsRepublish, resolutions };
  }

  private async recordFailure(error: unknown): Promise<void> {
    const settings = this.host.getSettings();
    const code = safeErrorCode(error);
    if (
      code === "signed_out" ||
      (error instanceof CloudRelayError && error.status === 401)
    ) {
      settings.cloudStatus = "paused_signed_out";
    } else if (code.includes("requires_paid_plan")) {
      settings.cloudStatus = "paused_plan";
    } else if (code === "not_publisher") {
      settings.cloudStatus = "paused_other_publisher";
    } else if (
      code === "obsidian_vault_limit_reached" ||
      code === "obsidian_active_vault_changed"
    ) {
      settings.cloudStatus = "paused_vault_replacement";
    } else {
      settings.cloudStatus = "retryable_error";
      settings.cloudRetryAttempt += 1;
      const base = Math.min(
        MAX_RETRY_MS,
        MIN_RETRY_MS * 2 ** Math.min(settings.cloudRetryAttempt - 1, 5),
      );
      const jitter =
        0.8 +
        (globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! /
          0xffff_ffff) *
          0.4;
      settings.cloudRetryAt = new Date(
        Date.now() + Math.round(base * jitter),
      ).toISOString();
    }
    settings.cloudLastErrorCode = code;
    await this.host.saveSettings();
  }
}

export function selectRelayTasks(
  tasks: readonly ObsidianSnapshotTask[],
): ObsidianSnapshotTask[] {
  const firstOwners = selectRelayTaskOwners(tasks);
  const active = firstOwners
    .filter((task) => task.status === "open")
    .sort(compareTaskPosition)
    .slice(0, MAX_ACTIVE_TASKS);
  const completed = firstOwners
    .filter((task) => task.status === "completed")
    .sort((left, right) => {
      const dateOrder = (right.completedAt ?? "").localeCompare(
        left.completedAt ?? "",
      );
      return dateOrder || compareTaskPosition(left, right);
    })
    .slice(0, MAX_COMPLETED_TASKS);
  return [...active, ...completed];
}

export function selectRelayTaskOwners(
  tasks: readonly ObsidianSnapshotTask[],
): ObsidianSnapshotTask[] {
  const firstOwners: ObsidianSnapshotTask[] = [];
  const seenProviderTaskIds = new Set<string>();
  for (const task of [...tasks].sort(compareTaskPosition)) {
    if (seenProviderTaskIds.has(task.providerTaskId)) {
      continue;
    }
    seenProviderTaskIds.add(task.providerTaskId);
    firstOwners.push(task);
  }
  return firstOwners;
}

export function classifyPendingOperation(
  operation: CloudPendingOperation,
  localStatus: "open" | "completed",
  desiredStatus: "open" | "completed" | null,
):
  | "already_applied"
  | "stale_server_version"
  | "local_status_changed"
  | "write" {
  if (desiredStatus !== null && localStatus === desiredStatus) {
    return "already_applied";
  }
  if (
    operation.base_server_version === null ||
    operation.base_server_version !== operation.current_task_server_version
  ) {
    return "stale_server_version";
  }
  if (localStatus !== operation.current_task_status) {
    return "local_status_changed";
  }
  return "write";
}

function toLocalOperation(
  operation: CloudPendingOperation,
  task: ObsidianSnapshotTask,
  desiredStatus: "open" | "completed" | null,
): PendingMutationOperation {
  return {
    id: operation.operation_id,
    operationType: operation.operation_type,
    task: {
      id: operation.task_id,
      title: task.title,
      status: desiredStatus ?? "deleted",
      priority: task.priority,
      labels: task.labels,
      dueAt: task.dueAt,
    },
    source: task,
  };
}

function appliedResolution(
  operation: CloudPendingOperation,
  reason = operation.operation_type === "delete"
    ? "task_deleted"
    : "status_applied",
): {
  operation_id: string;
  status: "applied";
  result: Record<string, unknown>;
} {
  return {
    operation_id: operation.operation_id,
    status: "applied",
    result: { reason },
  };
}

function projectionDigest(projection: CloudTaskProjection): string {
  const { previous_provider_task_id: _alias, ...stableProjection } = projection;
  return sha256(JSON.stringify(stableProjection));
}

function compareTaskPosition(
  left: ObsidianSnapshotTask,
  right: ObsidianSnapshotTask,
): number {
  return (
    left.notePath.localeCompare(right.notePath) ||
    left.lineNumber - right.lineNumber ||
    left.providerTaskId.localeCompare(right.providerTaskId)
  );
}

function isMarkdownFile(file: unknown): file is TFile {
  return Boolean(
    file &&
    typeof file === "object" &&
    "extension" in file &&
    (file as { extension?: unknown }).extension === "md",
  );
}

function clearCloudMapping(settings: DainvoPluginSettings): void {
  settings.cloudVaultId = "";
  settings.cloudVaultKey = settings.vaultId;
  settings.cloudPublishedDigests = {};
  settings.cloudOperationJournal = {};
  settings.cloudOperationBacklog = 0;
  settings.cloudLastPublishedAt = "";
  settings.cloudLastFullSyncAt = "";
  settings.cloudRetryAttempt = 0;
  settings.cloudRetryAt = "";
  settings.cloudLastErrorCode = "";
}

function pinCloudVaultIdentity(settings: DainvoPluginSettings): void {
  if (settings.cloudVaultKey === settings.vaultId) {
    return;
  }
  settings.cloudVaultKey = settings.vaultId;
  settings.cloudVaultId = "";
  settings.cloudPublishedDigests = {};
  settings.cloudOperationJournal = {};
  settings.cloudOperationBacklog = 0;
  settings.cloudLastPublishedAt = "";
  settings.cloudLastFullSyncAt = "";
}

export function selectActiveCloudVault(
  vaults: readonly CloudPublisherVault[],
): CloudPublisherVault | null {
  return (
    vaults
      .filter((vault) => vault.sync_enabled)
      .slice()
      .sort((left, right) => {
        const publishedOrder = compareNullableIsoDesc(
          left.last_published_at,
          right.last_published_at,
        );
        if (publishedOrder !== 0) {
          return publishedOrder;
        }
        if (left.server_version !== right.server_version) {
          return right.server_version - left.server_version;
        }
        return right.id.localeCompare(left.id);
      })[0] ?? null
  );
}

function compareNullableIsoDesc(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right.localeCompare(left);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof CloudRelayError) {
    return error.code;
  }
  if (error instanceof DainvoOAuthError) {
    return error.code;
  }
  if (error instanceof Error) {
    const normalized = error.message
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_ -]+/g, "");
    return normalized.replace(/\s+/g, "_").slice(0, 120) || "unknown_error";
  }
  return "unknown_error";
}
