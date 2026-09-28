import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  isCloudPublicationIntent,
  type CloudPublicationIntent,
} from "../src/types";

vi.mock("obsidian", () => ({
  normalizePath: (value: string) => value.replace(/\\/g, "/"),
  requestUrl: vi.fn(),
}));

let classifyPendingOperation: typeof import("../src/cloudSync").classifyPendingOperation;
let selectRelayTasks: typeof import("../src/cloudSync").selectRelayTasks;
let selectRelayPublication: typeof import("../src/cloudSync").selectRelayPublication;
let selectActiveCloudVault: typeof import("../src/cloudSync").selectActiveCloudVault;
let selectCloudVaultByStableId: typeof import("../src/cloudSync").selectCloudVaultByStableId;
let ObsidianCloudSyncCoordinator: typeof import("../src/cloudSync").ObsidianCloudSyncCoordinator;

beforeAll(async () => {
  ({
    classifyPendingOperation,
    selectRelayTasks,
    selectRelayPublication,
    selectActiveCloudVault,
    selectCloudVaultByStableId,
    ObsidianCloudSyncCoordinator,
  } = await import("../src/cloudSync"));
});

const operation = {
  id: "cloud-operation",
  operation_id: "mobile-operation",
  operation_type: "complete" as const,
  task_id: "cloud-task",
  provider_task_id: "vault:block:dainvo-task",
  local_vault_id: "vault",
  base_server_version: 4,
  current_task_status: "open" as const,
  current_task_server_version: 4,
};

const publicationIntent = (): CloudPublicationIntent => ({
  cloudVaultId: "cloud-vault",
  deviceId: "device",
  publication: {
    schema_version: 2,
    publisher_epoch: "epoch",
    publication_id: "publication",
    sequence: 2,
    base_sequence: 1,
    publication_digest: "digest",
    capabilities: [
      "ordered_publication",
      "explicit_source_deletion",
      "coverage_counts",
    ],
    coverage: {
      source_inventory_complete: true,
      source_inventory_digest: "inventory",
      active: { eligible_count: 1, selected_count: 1, omitted_count: 0 },
      completed: { eligible_count: 0, selected_count: 0, omitted_count: 0 },
      retained_target_count: 0,
    },
    removed_provider_task_ids: [],
  },
  upserts: [],
  presentProviderTaskIds: ["task"],
  publishedAt: "2026-09-26T12:00:00.000Z",
  nextPublishedDigests: { task: "digest" },
  nextKnownPublishedTaskIds: ["task"],
  acknowledgedAliasBlockIds: [],
});

describe("durable publication validation", () => {
  it("accepts a complete ordered publication intent", () => {
    expect(isCloudPublicationIntent(publicationIntent())).toBe(true);
  });

  it("rejects malformed or non-contiguous persisted intents", () => {
    expect(isCloudPublicationIntent({ publication: {} })).toBe(false);
    expect(
      isCloudPublicationIntent({
        ...publicationIntent(),
        publication: { ...publicationIntent().publication, sequence: 3 },
      }),
    ).toBe(false);
  });
});

describe("cloud pending-operation conflict handling", () => {
  it("treats an already matching local status as applied", () => {
    expect(classifyPendingOperation(operation, "completed", "completed")).toBe(
      "already_applied",
    );
  });

  it("rejects stale and missing base versions when status differs", () => {
    expect(
      classifyPendingOperation(
        { ...operation, base_server_version: 3 },
        "open",
        "completed",
      ),
    ).toBe("stale_server_version");
    expect(
      classifyPendingOperation(
        { ...operation, base_server_version: null },
        "open",
        "completed",
      ),
    ).toBe("stale_server_version");
  });

  it("conflicts when Markdown changed locally after the server projection", () => {
    expect(classifyPendingOperation(operation, "completed", "open")).toBe(
      "local_status_changed",
    );
  });

  it("allows a write only when server and local state still agree", () => {
    expect(classifyPendingOperation(operation, "open", "completed")).toBe(
      "write",
    );
  });

  it("allows delete only for the current projected version and status", () => {
    const deletion = { ...operation, operation_type: "delete" as const };
    expect(classifyPendingOperation(deletion, "open", null)).toBe("write");
    expect(
      classifyPendingOperation(
        { ...deletion, current_task_server_version: 5 },
        "open",
        null,
      ),
    ).toBe("stale_server_version");
    expect(classifyPendingOperation(deletion, "completed", null)).toBe(
      "local_status_changed",
    );
  });
});

describe("relay task window selection", () => {
  it("keeps blank snapshot nodes out of the mobile relay", () => {
    const blank = { ...relayTask("blank", "Blank.md", "open"), isBlank: true };
    expect(selectRelayTasks([blank])).toEqual([]);
  });

  it("preserves the first duplicate owner and applies independent task windows", () => {
    const tasks = [
      relayTask("duplicate", "Z.md", "open"),
      relayTask("duplicate", "A.md", "completed"),
      ...Array.from({ length: 301 }, (_, index) =>
        relayTask(`active-${index}`, `Active/${index}.md`, "open"),
      ),
      ...Array.from({ length: 701 }, (_, index) =>
        relayTask(`completed-${index}`, `Completed/${index}.md`, "completed"),
      ),
    ];

    const selected = selectRelayTasks(tasks);

    expect(selected.filter((task) => task.status === "open")).toHaveLength(300);
    expect(selected.filter((task) => task.status === "completed")).toHaveLength(
      700,
    );
    expect(
      selected.filter((task) => task.providerTaskId === "duplicate"),
    ).toEqual([expect.objectContaining({ notePath: "A.md" })]);
  });

  it("drains retained targets beyond ordinary windows using the durable sequence", () => {
    const tasks = Array.from({ length: 1700 }, (_, index) => ({
      ...relayTask(`task-${String(index).padStart(4, "0")}`, "Tasks.md", index < 700 ? "open" : "completed"),
      completedAt: index < 700 ? null : "2026-09-26T00:00:00Z",
    }));
    const ids = tasks.map((task) => task.providerTaskId);
    const visited = new Set<string>();
    for (let sequence = 0; sequence < 7; sequence += 1) {
      const result = selectRelayPublication(tasks, ids, sequence);
      expect(result.selected).toHaveLength(1100);
      expect(result.coverage.retained).toMatchObject({ eligible_count: 700, selected_count: 100, omitted_count: 600 });
      expect(selectRelayPublication([...tasks].reverse(), ids, sequence)).toEqual(result);
      result.selected.forEach((task) => visited.add(task.providerTaskId));
    }
    expect(visited.size).toBe(1700);
  });

  it("keeps operation targets and their ancestors inside bounded windows", () => {
    const parent = relayTask("parent", "Z-parent.md", "open");
    const child = {
      ...relayTask("child", "Z-child.md", "open"),
      parentProviderTaskId: "parent",
    };
    const ordinary = Array.from({ length: 300 }, (_, index) =>
      relayTask(`ordinary-${index}`, `A/${index}.md`, "open"),
    );

    const publication = selectRelayPublication(
      [...ordinary, parent, child],
      ["child"],
    );

    expect(publication.selected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerTaskId: "parent" }),
        expect.objectContaining({ providerTaskId: "child" }),
      ]),
    );
    expect(publication.selected).toHaveLength(301);
    expect(publication.coverage.active).toEqual({
      eligible_count: 302,
      selected_count: 301,
      omitted_count: 1,
    });
    expect(publication.retainedTargetCount).toBe(2);
  });
});

describe("account-wide cloud vault selection", () => {
  it("uses stable IDs and deterministic server ranking for same-name vaults", () => {
    const base = {
      vault_name: "Notes",
      publisher_device_id: "device",
      publisher_kind: "obsidian_plugin" as const,
      identity_mode: "backfill_and_future" as const,
      sync_enabled: true,
      connection_status: "online" as const,
      last_published_at: "2026-07-20T10:00:00.000Z",
    };
    const selected = selectActiveCloudVault([
      { ...base, id: "cloud-a", vault_id: "stable-a", server_version: 3 },
      { ...base, id: "cloud-b", vault_id: "stable-b", server_version: 4 },
      {
        ...base,
        id: "cloud-disabled",
        vault_id: "stable-disabled",
        sync_enabled: false,
        last_published_at: "2026-07-20T12:00:00.000Z",
        server_version: 99,
      },
    ]);

    expect(selected).toEqual(
      expect.objectContaining({ id: "cloud-b", vault_id: "stable-b" }),
    );
  });

  it("keeps same-vault takeover separate from account-vault replacement", async () => {
    const coordinator = new ObsidianCloudSyncCoordinator(
      null as never,
      null as never,
      null as never,
      null as never,
    );

    await expect(
      coordinator.requestSync({
        takeover: true,
        replaceVaultId: "956c6b9e-b46a-4b85-bf76-4f4361f1b219",
      }),
    ).rejects.toMatchObject({ code: "invalid_publisher_action" });
  });

  it("resolves disable/purge by stable vault identity instead of a cached cloud UUID", () => {
    const base = {
      vault_name: "Notes",
      publisher_device_id: "device",
      publisher_kind: "obsidian_plugin" as const,
      identity_mode: "backfill_and_future" as const,
      sync_enabled: true,
      connection_status: "online" as const,
      last_published_at: "2026-07-20T10:00:00.000Z",
      server_version: 1,
    };
    const vaults = [
      { ...base, id: "cloud-current", vault_id: "stable-current" },
      { ...base, id: "cloud-other", vault_id: "stable-other" },
    ];

    expect(selectCloudVaultByStableId(vaults, "stable-current")?.id).toBe(
      "cloud-current",
    );
    expect(selectCloudVaultByStableId(vaults, "stable-missing")).toBeNull();
  });

  it("does not purge the active account vault when a legacy cached UUID belongs to another stable vault", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      vaultId: "stable-current",
      cloudVaultKey: "stable-current",
      cloudVaultId: "cloud-active-other",
      cloudSyncEnabled: true,
      cloudStatus: "published" as const,
    };
    const disableVault = vi.fn();
    const coordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: null as never,
        getSettings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getDeviceId: () => "device",
        ensureBridgeIdentityAliasSupport: vi.fn().mockResolvedValue(undefined),
      },
      { getValidSession: vi.fn().mockResolvedValue({}) } as never,
      {
        listPublisherVaults: vi.fn().mockResolvedValue([
          {
            id: "cloud-active-other",
            vault_id: "stable-other",
            vault_name: "Notes",
            publisher_device_id: "device",
            publisher_kind: "obsidian_plugin",
            identity_mode: "backfill_and_future",
            sync_enabled: true,
            connection_status: "online",
            last_published_at: "2026-07-20T10:00:00.000Z",
            server_version: 1,
          },
        ]),
        disableVault,
      } as never,
      null as never,
    );

    await coordinator.disableAndPurge();

    expect(disableVault).not.toHaveBeenCalled();
    expect(settings.cloudSyncEnabled).toBe(false);
    expect(settings.cloudVaultId).toBe("");
    expect(settings.cloudStatus).toBe("disabled");
  });

  it("keeps Project-note configuration out of cloud task publication", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      vaultId: "stable-current",
      vaultName: "Notes",
      projectNoteFolder: "Client Projects",
      cloudVaultKey: "stable-current",
      cloudSyncEnabled: true,
      cloudStatus: "published" as const,
      cloudEntitled: true,
    };
    const file = { path: "Tasks.md", extension: "md" };
    const pushSnapshot = vi
      .fn()
      .mockImplementation(async (input: CloudPublicationIntent) => ({
      publisher_epoch: input.publication.publisher_epoch,
      publication_id: input.publication.publication_id,
      sequence: input.publication.sequence,
      base_sequence: input.publication.base_sequence,
      }));
    const coordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: {
          getMarkdownFiles: () => [file],
          cachedRead: vi.fn().mockResolvedValue("- [ ] Cloud task ^task-id"),
          getAbstractFileByPath: vi.fn(),
        } as never,
        getSettings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getDeviceId: () => "device",
        ensureBridgeIdentityAliasSupport: vi.fn().mockResolvedValue(undefined),
      },
      {
        getValidSession: vi.fn().mockResolvedValue({ userId: "user" }),
      } as never,
      {
        getAccess: vi.fn().mockResolvedValue({
          allowed: true,
          plan_name: "Pro",
          plan_slug: "pro",
          reason: "",
        }),
        listPublisherVaults: vi.fn().mockResolvedValue([]),
        publishVault: vi.fn().mockResolvedValue({
          vault: { id: "cloud-vault", publisher_epoch: "publisher-epoch" },
          publication: {
            protocol_version: 2,
            publisher_epoch: "publisher-epoch",
            last_sequence: 0,
          },
        }),
        pushSnapshot,
        listPendingOperations: vi.fn().mockResolvedValue([]),
      } as never,
      {
        countBackfillCandidates: vi.fn().mockResolvedValue(0),
        normalize: vi.fn().mockResolvedValue({ changed: 0 }),
      } as never,
    );

    await coordinator.requestSync();

    expect(pushSnapshot).toHaveBeenCalledOnce();
    const payload = pushSnapshot.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("projectNoteSettings");
    expect(payload).not.toHaveProperty("projectNoteFolder");
    expect(JSON.stringify(payload)).not.toContain("Client Projects");
    expect(payload.publication).toMatchObject({
      schema_version: 2,
      sequence: 1,
      base_sequence: 0,
    });
    expect(settings.cloudPendingPublication).toBeNull();
    expect(settings.cloudPublicationSequence).toBe(1);
  });

  it("replays the exact durable publication after the response is lost", async () => {
    const settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      vaultId: "stable-current",
      vaultName: "Notes",
      cloudVaultKey: "stable-current",
      cloudSyncEnabled: true,
      cloudStatus: "published" as const,
      cloudEntitled: true,
    };
    const file = { path: "Tasks.md", extension: "md" };
    let committedIntent: unknown = null;
    const pushSnapshot = vi
      .fn()
      .mockImplementationOnce(async (input: CloudPublicationIntent) => {
        committedIntent = structuredClone(input);
        throw new Error("publication_response_lost");
      })
      .mockImplementationOnce(async (input: CloudPublicationIntent) => ({
        publisher_epoch: input.publication.publisher_epoch,
        publication_id: input.publication.publication_id,
        sequence: input.publication.sequence,
        base_sequence: input.publication.base_sequence,
      }));
    const publishVault = vi
      .fn()
      .mockResolvedValueOnce({
        vault: { id: "cloud-vault", publisher_epoch: "publisher-epoch" },
        publication: {
          protocol_version: 2,
          publisher_epoch: "publisher-epoch",
          last_sequence: 0,
        },
      })
      .mockResolvedValueOnce({
        vault: { id: "cloud-vault", publisher_epoch: "publisher-epoch" },
        publication: {
          protocol_version: 2,
          publisher_epoch: "publisher-epoch",
          last_sequence: 1,
        },
      });
    const coordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: {
          getMarkdownFiles: () => [file],
          cachedRead: vi.fn().mockResolvedValue("- [ ] Durable task ^task-id"),
          getAbstractFileByPath: vi.fn(),
        } as never,
        getSettings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getDeviceId: () => "device",
        ensureBridgeIdentityAliasSupport: vi.fn().mockResolvedValue(undefined),
      },
      {
        getValidSession: vi.fn().mockResolvedValue({ userId: "user" }),
      } as never,
      {
        getAccess: vi.fn().mockResolvedValue({
          allowed: true,
          plan_name: "Pro",
          plan_slug: "pro",
          reason: "",
        }),
        listPublisherVaults: vi.fn().mockResolvedValue([]),
        publishVault,
        pushSnapshot,
        listPendingOperations: vi.fn().mockResolvedValue([]),
      } as never,
      {
        countBackfillCandidates: vi.fn().mockResolvedValue(0),
        normalize: vi.fn().mockResolvedValue({ changed: 0 }),
      } as never,
    );

    await expect(coordinator.requestSync()).rejects.toThrow(
      "publication_response_lost",
    );
    expect(settings.cloudPendingPublication).not.toBeNull();
    expect(settings.cloudPublicationSequence).toBe(0);

    await coordinator.requestSync();

    expect(pushSnapshot).toHaveBeenCalledTimes(2);
    expect(pushSnapshot.mock.calls[1]?.[0]).toEqual(committedIntent);
    expect(settings.cloudPendingPublication).toBeNull();
    expect(settings.cloudPublicationSequence).toBe(1);
  });
});

describe("cloud operation drain continuation", () => {
  it("defers a filesystem failure while independent targets continue", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const tasks = ['blocked', 'healthy'].map((id) => relayTask(id, `${id}.md`, 'open'));
    for (const task of tasks) settings.cloudOperationJournal[task.providerTaskId] = {
      state: 'pending_write', receivedAt: '2026-09-26T12:00:00.000Z', operation: { ...operation, operation_id: task.providerTaskId, provider_task_id: task.providerTaskId }
    };
    const process = vi.fn(async (file: { path: string }) => {
      if (file.path === 'blocked.md') throw new Error('EACCES');
      return '- [x] healthy';
    });
    const coordinator = new ObsidianCloudSyncCoordinator({
      getSettings: () => settings, saveSettings: vi.fn().mockResolvedValue(undefined),
      vault: { getAbstractFileByPath: (path: string) => ({ path, extension: 'md' }), process },
    } as never, {} as never, {} as never, {} as never);
    const internal = coordinator as unknown as { taskIndex: Map<string, typeof tasks>; applyPendingOperations(): Promise<{ resolutions: Array<{ operation_id: string; status: string }> }> };
    internal.taskIndex.set('tasks', tasks);
    const result = await internal.applyPendingOperations();
    expect(result.resolutions).toEqual([expect.objectContaining({ operation_id: 'healthy', status: 'applied' })]);
    expect(settings.cloudOperationJournal.blocked.retryAt).toBeTruthy();
    expect(settings.cloudOperationJournal.blocked.attempts).toBe(1);
    expect(settings.cloudOperationJournal.healthy.state).toBe('written_pending_publish');
    await internal.applyPendingOperations();
    expect(process).toHaveBeenCalledTimes(2);
  });

  it("persists and schedules another turn after a full publisher page", async () => {
    const settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      vaultId: "stable-current",
      vaultName: "Notes",
      cloudVaultKey: "stable-current",
      cloudSyncEnabled: true,
      cloudStatus: "published" as const,
      cloudEntitled: true,
    };
    const file = { path: "Tasks.md", extension: "md" };
    const requestCloudContinuation = vi.fn();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...operation,
      id: `row-${index}`,
      operation_id: `operation-${index}`,
      task_id: `cloud-task-${index}`,
      provider_task_id: `missing:${index}`,
    }));
    const finalOperation = {
      ...operation,
      id: "row-100",
      operation_id: "operation-100",
      task_id: "cloud-task-100",
      provider_task_id: "missing:100",
    };
    const listPendingOperations = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([finalOperation]);
    const resolveOperations = vi.fn().mockResolvedValue({
      resolved: 100,
      skipped: 0,
    });
    const pushSnapshot = vi
      .fn()
      .mockImplementation(async (input: CloudPublicationIntent) => ({
      publisher_epoch: input.publication.publisher_epoch,
      publication_id: input.publication.publication_id,
      sequence: input.publication.sequence,
      base_sequence: input.publication.base_sequence,
      }));
    const coordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: {
          getMarkdownFiles: () => [file],
          cachedRead: vi.fn().mockResolvedValue("- [ ] Local task ^task-id"),
          getAbstractFileByPath: vi.fn(),
        } as never,
        getSettings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getDeviceId: () => "device",
        ensureBridgeIdentityAliasSupport: vi.fn().mockResolvedValue(undefined),
        requestCloudContinuation,
      },
      {
        getValidSession: vi.fn().mockResolvedValue({ userId: "user" }),
      } as never,
      {
        getAccess: vi.fn().mockResolvedValue({
          allowed: true,
          plan_name: "Pro",
          plan_slug: "pro",
          reason: "",
        }),
        listPublisherVaults: vi.fn().mockResolvedValue([]),
        publishVault: vi.fn().mockImplementation(async () => ({
          vault: { id: "cloud-vault", publisher_epoch: "publisher-epoch" },
          publication: {
            protocol_version: 2,
            publisher_epoch: "publisher-epoch",
            last_sequence: settings.cloudPublicationSequence,
          },
        })),
        pushSnapshot,
        listPendingOperations,
        resolveOperations,
      } as never,
      {
        countBackfillCandidates: vi.fn().mockResolvedValue(0),
        normalize: vi.fn().mockResolvedValue({ changed: 0 }),
      } as never,
    );

    await coordinator.requestSync();

    expect(settings.cloudOperationContinuation).toBe(true);
    expect(requestCloudContinuation).toHaveBeenCalledOnce();
    expect((resolveOperations.mock.calls[0]?.[0] as { resolutions: unknown[] }).resolutions).toHaveLength(100);

    await coordinator.requestSync();

    expect(settings.cloudOperationContinuation).toBe(false);
    expect((resolveOperations.mock.calls[1]?.[0] as { resolutions: unknown[] }).resolutions).toHaveLength(1);
    expect(listPendingOperations).toHaveBeenCalledTimes(2);
    expect(listPendingOperations.mock.calls[0]?.[0]).toMatchObject({
      cloudVaultId: "cloud-vault",
      deviceId: "device",
      publisherEpoch: "publisher-epoch",
    });
    expect(resolveOperations.mock.calls[0]?.[0]).toMatchObject({
      cloudVaultId: "cloud-vault",
      deviceId: "device",
      publisherEpoch: "publisher-epoch",
    });
  });
});

function relayTask(
  providerTaskId: string,
  notePath: string,
  status: "open" | "completed",
) {
  return {
    providerTaskId,
    title: providerTaskId,
    status,
    priority: 4,
    labels: [],
    dueAt: null,
    completedAt: status === "completed" ? "2026-07-17T00:00:00.000Z" : null,
    notePath,
    noteTitle: notePath,
    heading: null,
    lineNumber: 1,
    blockId: providerTaskId,
    lineHash: providerTaskId,
    rawTaskLine: `- [${status === "completed" ? "x" : " "}] ${providerTaskId}`,
    openUri: "obsidian://open",
    parserFormat: "markdown" as const,
    indentColumns: 0,
    parentProviderTaskId: null,
    siblingOrder: 0,
  };
}
