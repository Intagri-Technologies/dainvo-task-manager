import type { ParsedTaskLine } from "./taskLine";

export type CloudSyncStatus =
  | "disabled"
  | "signing_in"
  | "normalizing_ids"
  | "publishing"
  | "published"
  | "retryable_error"
  | "paused_signed_out"
  | "paused_plan"
  | "paused_account"
  | "paused_other_publisher"
  | "disable_pending";

export type StableIdMode = "backfill_and_future" | "future_only";

export type StableIdJournalIntent = {
  notePath: string;
  lineNumber: number;
  expectedLineHash: string;
  newBlockId: string;
  previousNotePath: string | null;
  previousLineNumber: number | null;
  replaceBlockId: string | null;
};

export type StableIdJournal = {
  id: string;
  createdAt: string;
  mode: StableIdMode;
  intents: StableIdJournalIntent[];
  completedFiles: string[];
};

export type IdentityAliasRecord = {
  blockId: string;
  notePath: string;
  lineNumber: number;
  cloudPending: boolean;
  bridgePending: boolean;
};

export type FutureTaskIndexEntry = {
  lineNumber: number;
  lineHash: string;
  titleHash: string;
};

export type CloudOperationJournalEntry = {
  operation: CloudPendingOperation;
  state: "pending_write" | "written_pending_publish";
  receivedAt: string;
};

export type DainvoPluginSettings = {
  bridgeBaseUrl: string;
  pairingCode: string;
  bearerToken: string;
  accountId: string;
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  vaultConfigDir: string;
  dailyNoteDateFormat: string;
  dailyNoteFolder: string;
  dailyNoteTemplatePath: string;
  dailyNoteSettingsOverrideEnabled: boolean;
  dailyNoteSectionHeading: string;
  dailyNoteCreateEnabled: boolean;
  lastStatus: string;
  lastSnapshotAt: string;
  cloudSyncEnabled: boolean;
  cloudStatus: CloudSyncStatus;
  cloudOwnerUserId: string;
  cloudPlanName: string;
  cloudEntitled: boolean;
  cloudVaultId: string;
  cloudVaultKey: string;
  cloudIdentityMode: StableIdMode;
  cloudLastPublishedAt: string;
  cloudLastFullSyncAt: string;
  cloudLastErrorCode: string;
  cloudOperationBacklog: number;
  cloudRetryAttempt: number;
  cloudRetryAt: string;
  cloudPublishedDigests: Record<string, string>;
  stableIdJournal: StableIdJournal | null;
  identityAliases: Record<string, IdentityAliasRecord>;
  futureTaskIndex: Record<string, FutureTaskIndexEntry[]>;
  futureTaskBaselineDeviceId: string;
  duplicateStableIdCount: number;
  cloudOperationJournal: Record<string, CloudOperationJournalEntry>;
};

export type DailyNoteSettings = {
  dateFormat: string;
  folder: string;
  templatePath: string | null;
  sectionHeading: string;
  createEnabled: boolean;
  overrideEnabled: boolean;
  exportedAt: string | null;
};

export type ObsidianSnapshotTask = {
  providerTaskId: string;
  previousProviderTaskId?: string;
  title: string;
  status: 'open' | 'completed';
  priority: number;
  labels: string[];
  dueAt: string | null;
  completedAt: string | null;
  notePath: string;
  noteTitle: string | null;
  heading: string | null;
  lineNumber: number;
  blockId: string | null;
  lineHash: string;
  rawTaskLine: string;
  openUri: string;
  parserFormat: 'markdown' | 'tasks';
};

export type ParsedTaskCandidate = {
  lineNumber: number;
  line: string;
  heading: string | null;
  parsed: ParsedTaskLine;
};

export type ObsidianSnapshotPayload = {
  schemaVersion: 1;
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  vaultConfigDir: string;
  dailyNoteSettings: DailyNoteSettings;
  exportedAt: string;
  tasks: ObsidianSnapshotTask[];
};

export type PairResult = {
  accountId: string;
  token: string;
  baseUrl: string;
};

export type BridgeStatus = {
  ok: boolean;
  capabilities?: string[];
};

export type CloudSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
};

export type PendingPkce = {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
};

export type CloudSyncAccess = {
  allowed: boolean;
  plan_slug: string | null;
  plan_name: string | null;
  reason: "eligible" | "upgrade_required" | "signed_out" | string;
};

export type CloudPublisherVault = {
  id: string;
  vault_id: string;
  vault_name: string;
  publisher_device_id: string | null;
  publisher_kind: "desktop" | "obsidian_plugin";
  identity_mode: StableIdMode;
  operation_capabilities?: Array<"complete" | "reopen" | "delete">;
  sync_enabled: boolean;
  connection_status: "online" | "offline" | "stale";
  last_published_at: string | null;
  server_version: number;
};

export type CloudPendingOperation = {
  id: string;
  operation_id: string;
  operation_type: "complete" | "reopen" | "delete";
  task_id: string;
  provider_task_id: string;
  local_vault_id: string;
  base_server_version: number | null;
  current_task_status: "open" | "completed";
  current_task_server_version: number;
};

export type CloudTaskProjection = {
  provider_task_id: string;
  previous_provider_task_id?: string;
  title: string;
  status: "open" | "completed";
  priority: number;
  labels: string[];
  due_at: string | null;
  completed_at: string | null;
  note_path: string;
  note_title: string | null;
  heading: string | null;
  open_uri: string;
};

export type PendingMutationOperation = {
  id: string;
  operationType: 'update' | 'delete' | 'complete' | 'reopen' | 'move';
  task: {
    id: string;
    title: string;
    status: 'open' | 'completed' | 'deleted';
    priority: number;
    labels: string[];
    dueAt: string | null;
  };
  source: ObsidianSnapshotTask;
};

export type PendingOperation = PendingMutationOperation;

export const DEFAULT_SETTINGS: DainvoPluginSettings = {
  bridgeBaseUrl: '',
  pairingCode: '',
  bearerToken: '',
  accountId: '',
  vaultId: '',
  vaultName: '',
  vaultPath: '',
  vaultConfigDir: '.obsidian',
  dailyNoteDateFormat: '',
  dailyNoteFolder: '',
  dailyNoteTemplatePath: '',
  dailyNoteSettingsOverrideEnabled: false,
  dailyNoteSectionHeading: '## Dainvo',
  dailyNoteCreateEnabled: true,
  lastStatus: 'Not paired',
  lastSnapshotAt: '',
  cloudSyncEnabled: false,
  cloudStatus: "disabled",
  cloudOwnerUserId: "",
  cloudPlanName: "",
  cloudEntitled: false,
  cloudVaultId: "",
  cloudVaultKey: "",
  cloudIdentityMode: "backfill_and_future",
  cloudLastPublishedAt: "",
  cloudLastFullSyncAt: "",
  cloudLastErrorCode: "",
  cloudOperationBacklog: 0,
  cloudRetryAttempt: 0,
  cloudRetryAt: "",
  cloudPublishedDigests: {},
  stableIdJournal: null,
  identityAliases: {},
  futureTaskIndex: {},
  futureTaskBaselineDeviceId: "",
  duplicateStableIdCount: 0,
  cloudOperationJournal: {},
};
