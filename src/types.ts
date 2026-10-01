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
  | "paused_vault_replacement"
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
  retryAt?: string;
  attempts?: number;
  lastErrorCode?: string;
  operation: CloudPendingOperation;
  state: "pending_write" | "written_pending_publish";
  receivedAt: string;
};

export type DainvoPluginSettings = {
  cloudOperationScanCursor?: { requestedAt: string; id: string } | null;
  localPublisherEpoch?: string;
  localPublicationSequence?: number;
  localPendingPublication?: ObsidianSnapshotPayload | null;
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
  itemNotePlacement: ItemNotePlacement;
  itemNoteFolder: string;
  itemNoteUseDayFolder: boolean;
  itemNoteIncludeStartTime: boolean;
  itemNoteInitialContent: ItemNoteInitialContent;
  projectNoteFolder: string;
  // The paired desktop's deep-link scheme (dainvo or dainvo-dev).
  desktopDeepLinkScheme: string;
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
  /** A full publisher page was received and another durable drain is required. */
  cloudOperationContinuation: boolean;
  cloudRetryAttempt: number;
  cloudRetryAt: string;
  cloudPublisherEpoch: string;
  cloudPublicationSequence: number;
  cloudPendingPublication: CloudPublicationIntent | null;
  cloudKnownPublishedTaskIds: string[];
  cloudPublishedDigests: Record<string, string>;
  stableIdJournal: StableIdJournal | null;
  identityAliases: Record<string, IdentityAliasRecord>;
  futureTaskIndex: Record<string, FutureTaskIndexEntry[]>;
  futureTaskBaselineDeviceId: string;
  duplicateStableIdCount: number;
  cloudOperationJournal: Record<string, CloudOperationJournalEntry>;
  bridgeOperationJournal: Record<string, { operation: PendingOperation; state: "prepared" | "written"; receipt?: WriteBackReceipt; move?: CrossNoteMoveJournal }>;
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

export type ItemNotePlacement = "daily-note-folder" | "dedicated-folder";

export type ItemNoteInitialContent = "blank" | "title-heading";

export type ItemNoteSettings = {
  placement: ItemNotePlacement;
  folder: string;
  useDayFolder: boolean;
  includeStartTime: boolean;
  initialContent: ItemNoteInitialContent;
  exportedAt: string;
};

export type ProjectNoteSettings = {
  folder: string;
  exportedAt: string;
};

export type ObsidianSnapshotTask = {
  providerTaskId: string;
  previousProviderTaskId?: string;
  title: string;
  status: "open" | "completed";
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
  parserFormat: "markdown" | "tasks";
  indentColumns: number;
  parentProviderTaskId: string | null;
  siblingOrder: number;
  isBlank?: boolean;
  /** The note's modified time (ISO), sent to the desktop for last-edit-wins. */
  noteModifiedAt?: string;
};

export type ParsedTaskCandidate = {
  lineNumber: number;
  line: string;
  heading: string | null;
  parsed: ParsedTaskLine;
};

export type ObsidianSnapshotPayload = {
  publication?: { version: 2; epoch: string; sequence: number; baseSequence: number; id: string; completeInventory: true };
  schemaVersion: 2;
  pluginVersion: string;
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  vaultConfigDir: string;
  dailyNoteSettings: DailyNoteSettings;
  itemNoteSettings?: ItemNoteSettings;
  projectNoteSettings?: ProjectNoteSettings;
  exportedAt: string;
  writeCapabilities?: string[];
  tasks: ObsidianSnapshotTask[];
};

export type PairResult = {
  publisherEpoch?: string;
  accountId: string;
  token: string;
  baseUrl: string;
  deepLinkScheme?: string;
};

export type BridgeStatus = {
  ok: boolean;
  capabilities?: string[];
  deepLinkScheme?: string;
};

export type ProjectNoteLinkResult = {
  link: {
    projectId: string;
    projectName: string;
    blockId: string | null;
  } | null;
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
  reason: string;
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
  publication_protocol_version?: number;
  publisher_epoch?: string | null;
  last_publication_sequence?: number;
  publication_capabilities?: string[];
  publication_coverage?: CloudPublicationCoverage;
};

export type CloudPublicationCount = {
  eligible_count: number;
  selected_count: number;
  omitted_count: number;
};

export type CloudPublicationCoverage = {
  source_inventory_complete: boolean;
  source_inventory_digest?: string;
  active: CloudPublicationCount;
  completed: CloudPublicationCount;
  retained_target_count: number;
  retained?: CloudPublicationCount & { provider_task_ids: string[] };
};

export type CloudPublicationEnvelope = {
  schema_version: 2;
  publisher_epoch: string;
  publication_id: string;
  sequence: number;
  base_sequence: number;
  publication_digest: string;
  capabilities: readonly [
    "ordered_publication",
    "explicit_source_deletion",
    "coverage_counts",
  ];
  coverage: CloudPublicationCoverage;
  removed_provider_task_ids: string[];
};

export type CloudPublicationIntent = {
  cloudVaultId: string;
  deviceId: string;
  publication: CloudPublicationEnvelope;
  upserts: CloudTaskProjection[];
  presentProviderTaskIds: string[];
  publishedAt: string;
  nextPublishedDigests: Record<string, string>;
  nextKnownPublishedTaskIds: string[];
  acknowledgedAliasBlockIds: string[];
};

export function isCloudPublicationIntent(
  value: unknown,
): value is CloudPublicationIntent {
  if (!isRecord(value) || !isNonEmptyString(value.cloudVaultId)) return false;
  if (!isNonEmptyString(value.deviceId) || !isRecord(value.publication)) {
    return false;
  }

  const publication = value.publication;
  if (
    publication.schema_version !== 2 ||
    !isNonEmptyString(publication.publisher_epoch) ||
    !isNonEmptyString(publication.publication_id) ||
    !isNonNegativeInteger(publication.sequence) ||
    !isNonNegativeInteger(publication.base_sequence) ||
    publication.sequence !== publication.base_sequence + 1 ||
    !isNonEmptyString(publication.publication_digest) ||
    !isCloudPublicationCoverage(publication.coverage) ||
    !isStringArray(publication.removed_provider_task_ids)
  ) {
    return false;
  }

  if (
    !Array.isArray(publication.capabilities) ||
    publication.capabilities.length !== 3 ||
    publication.capabilities[0] !== "ordered_publication" ||
    publication.capabilities[1] !== "explicit_source_deletion" ||
    publication.capabilities[2] !== "coverage_counts"
  ) {
    return false;
  }

  return (
    Array.isArray(value.upserts) &&
    value.upserts.every(isCloudTaskProjection) &&
    isStringArray(value.presentProviderTaskIds) &&
    isNonEmptyString(value.publishedAt) &&
    isStringRecord(value.nextPublishedDigests) &&
    isStringArray(value.nextKnownPublishedTaskIds) &&
    isStringArray(value.acknowledgedAliasBlockIds)
  );
}

function isCloudPublicationCoverage(
  value: unknown,
): value is CloudPublicationCoverage {
  if (!isRecord(value) || typeof value.source_inventory_complete !== "boolean") {
    return false;
  }
  if (
    value.source_inventory_digest !== undefined &&
    typeof value.source_inventory_digest !== "string"
  ) {
    return false;
  }
  return (
    isCloudPublicationCount(value.active) &&
    isCloudPublicationCount(value.completed) &&
    isNonNegativeInteger(value.retained_target_count) &&
    (value.retained === undefined || isRetainedPublicationCoverage(value.retained))
  );
}

function isRetainedPublicationCoverage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const ids = value.provider_task_ids;
  return isCloudPublicationCount(value) && Array.isArray(ids) &&
    value.selected_count <= 100 && ids.length === value.selected_count &&
    ids.every(isNonEmptyString) && new Set(ids).size === value.selected_count;
}

function isCloudPublicationCount(value: unknown): value is CloudPublicationCount {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.eligible_count) &&
    isNonNegativeInteger(value.selected_count) &&
    isNonNegativeInteger(value.omitted_count) &&
    value.selected_count + value.omitted_count === value.eligible_count
  );
}

function isCloudTaskProjection(value: unknown): value is CloudTaskProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.provider_task_id) &&
    (value.parent_provider_task_id === null ||
      typeof value.parent_provider_task_id === "string") &&
    isNonNegativeInteger(value.sibling_order) &&
    isNonNegativeInteger(value.indent_columns) &&
    typeof value.title === "string" &&
    (value.status === "open" || value.status === "completed") &&
    typeof value.priority === "number" &&
    isStringArray(value.labels) &&
    (value.due_at === null || typeof value.due_at === "string") &&
    (value.completed_at === null || typeof value.completed_at === "string") &&
    typeof value.note_path === "string" &&
    (value.note_title === null || typeof value.note_title === "string") &&
    (value.heading === null || typeof value.heading === "string") &&
    typeof value.open_uri === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export type CloudVaultReplacementSummary = {
  purgedTaskCount: number;
  discardedOperationCount: number;
};

export type CloudPendingOperation = {
  requested_at?: string;
  id: string;
  operation_id: string;
  operation_type: "complete" | "reopen" | "delete";
  task_id: string;
  provider_task_id: string;
  local_vault_id: string;
  base_server_version: number | null;
  current_task_status: "open" | "completed";
  current_task_server_version: number;
  /** The phone sends `edited_at`, its local edit time. */
  payload?: Record<string, unknown>;
};

export type CloudTaskProjection = {
  provider_task_id: string;
  previous_provider_task_id?: string;
  parent_provider_task_id: string | null;
  sibling_order: number;
  indent_columns: number;
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
  operationType: "create" | "update" | "delete" | "complete" | "reopen" | "move";
  task: {
    id: string;
    title: string;
    status: "open" | "completed" | "deleted";
    priority: number;
    labels: string[];
    dueAt: string | null;
  };
  source: ObsidianSnapshotTask;
  hierarchyMove?: ObsidianHierarchyMove;
  create?: {
    notePath: string;
    blockId: string;
    taskLine: string;
    sectionHeading: string;
    initialContent?: string;
    createNoteIfMissing: boolean;
  };
};

export type ObsidianHierarchyMoveTarget = Pick<
  ObsidianSnapshotTask,
  | "providerTaskId"
  | "notePath"
  | "lineNumber"
  | "blockId"
  | "lineHash"
  | "rawTaskLine"
>;

export type ObsidianHierarchyMove = {
  parentTaskId: string | null;
  parentProviderTaskId: string | null;
  target: ObsidianHierarchyMoveTarget | null;
};

export type WriteBackReceipt = {
  previousSource: { notePath: string; lineHash: string };
  writtenSource: ObsidianSnapshotTask | null;
};
export type CrossNoteMoveJournal = {
  sourceBlockLines: string[];
  destinationWritten: boolean;
};

export type PendingOperation = PendingMutationOperation;

export const DEFAULT_SETTINGS: DainvoPluginSettings = {
  bridgeBaseUrl: "",
  pairingCode: "",
  bearerToken: "",
  accountId: "",
  vaultId: "",
  vaultName: "",
  vaultPath: "",
  vaultConfigDir: "",
  dailyNoteDateFormat: "",
  dailyNoteFolder: "",
  dailyNoteTemplatePath: "",
  dailyNoteSettingsOverrideEnabled: false,
  dailyNoteSectionHeading: "## Dainvo",
  dailyNoteCreateEnabled: true,
  itemNotePlacement: "daily-note-folder",
  itemNoteFolder: "Item Notes",
  itemNoteUseDayFolder: false,
  itemNoteIncludeStartTime: false,
  itemNoteInitialContent: "title-heading",
  projectNoteFolder: "Projects",
  desktopDeepLinkScheme: "dainvo",
  lastStatus: "Not paired",
  lastSnapshotAt: "",
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
  cloudOperationContinuation: false,
  cloudRetryAttempt: 0,
  cloudRetryAt: "",
  cloudPublisherEpoch: "",
  cloudPublicationSequence: 0,
  cloudPendingPublication: null,
  cloudKnownPublishedTaskIds: [],
  cloudPublishedDigests: {},
  stableIdJournal: null,
  identityAliases: {},
  futureTaskIndex: {},
  futureTaskBaselineDeviceId: "",
  duplicateStableIdCount: 0,
  cloudOperationJournal: {},
  bridgeOperationJournal: {},
};
