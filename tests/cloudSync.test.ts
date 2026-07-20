import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/types";

vi.mock("obsidian", () => ({
  normalizePath: (value: string) => value.replace(/\\/g, "/"),
  requestUrl: vi.fn(),
}));

let classifyPendingOperation: typeof import("../src/cloudSync").classifyPendingOperation;
let selectRelayTasks: typeof import("../src/cloudSync").selectRelayTasks;
let selectActiveCloudVault: typeof import("../src/cloudSync").selectActiveCloudVault;
let selectCloudVaultByStableId: typeof import("../src/cloudSync").selectCloudVaultByStableId;
let ObsidianCloudSyncCoordinator: typeof import("../src/cloudSync").ObsidianCloudSyncCoordinator;

beforeAll(async () => {
  ({
    classifyPendingOperation,
    selectRelayTasks,
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
  };
}
