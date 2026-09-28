import { describe, expect, it, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock("obsidian", () => ({
  normalizePath: (value: string) => value.replace(/\\/g, "/"),
  requestUrl,
}));

import { CloudRelayError, DainvoCloudClient } from "../src/cloudClient";
import { ObsidianCloudSyncCoordinator } from "../src/cloudSync";
import { DEFAULT_SETTINGS, type CloudPublicationIntent } from "../src/types";

const baseSettings = () => ({
  ...structuredClone(DEFAULT_SETTINGS),
  vaultId: "stable-current",
  vaultName: "Notes",
  cloudVaultKey: "stable-current",
  cloudSyncEnabled: true,
  cloudStatus: "published" as const,
  cloudEntitled: true,
});

const vault = () =>
  ({
    getMarkdownFiles: () => [{ path: "Tasks.md", extension: "md" }],
    cachedRead: vi.fn().mockResolvedValue("- [ ] Durable task ^task-id"),
    getAbstractFileByPath: vi.fn(),
  }) as never;

describe("a persisted publication the server rejects as stale", () => {
  it("is dropped, and the next cycle adopts the server sequence and republishes", async () => {
    const settings = baseSettings();
    // Local durable state: same epoch as the server, but the server already
    // accepted a *different* publication at sequence 2 (e.g. overlapping
    // plugin instance during reload, or data.json rolled back by restore/sync).
    const stalePending: CloudPublicationIntent = {
      cloudVaultId: "cloud-vault",
      deviceId: "device",
      publication: {
        schema_version: 2,
        publisher_epoch: "epoch-1",
        publication_id: "local-publication",
        sequence: 2,
        base_sequence: 1,
        publication_digest: "a".repeat(64),
        capabilities: [
          "ordered_publication",
          "explicit_source_deletion",
          "coverage_counts",
        ],
        coverage: {
          source_inventory_complete: false,
          active: { eligible_count: 1, selected_count: 1, omitted_count: 0 },
          completed: { eligible_count: 0, selected_count: 0, omitted_count: 0 },
          retained_target_count: 0,
        },
        removed_provider_task_ids: ["gone-task"],
      },
      upserts: [],
      presentProviderTaskIds: ["task"],
      publishedAt: "2026-09-26T12:00:00.000Z",
      nextPublishedDigests: {},
      nextKnownPublishedTaskIds: [],
      acknowledgedAliasBlockIds: [],
    };
    settings.cloudVaultId = "cloud-vault";
    settings.cloudPublisherEpoch = "epoch-1";
    settings.cloudPublicationSequence = 1;
    settings.cloudPendingPublication = structuredClone(stalePending);

    // Server contract (push_my_obsidian_snapshot_v2): sequence <= last -> stale.
    const pushSnapshot = vi
      .fn()
      .mockRejectedValue(
        new CloudRelayError("stale_obsidian_publication", 400, false),
      );
    const coordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: vault(),
        getSettings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getDeviceId: () => "device",
        ensureBridgeIdentityAliasSupport: vi.fn().mockResolvedValue(undefined),
      },
      { getValidSession: vi.fn().mockResolvedValue({ userId: "user" }) } as never,
      {
        getAccess: vi.fn().mockResolvedValue({ allowed: true, plan_name: "Pro", plan_slug: "pro", reason: "" }),
        listPublisherVaults: vi.fn().mockResolvedValue([]),
        publishVault: vi.fn().mockResolvedValue({
          vault: { id: "cloud-vault", publisher_epoch: "epoch-1" },
          publication: { protocol_version: 2, publisher_epoch: "epoch-1", last_sequence: 2 },
        }),
        pushSnapshot,
        listPendingOperations: vi.fn().mockResolvedValue([]),
      } as never,
      {
        countBackfillCandidates: vi.fn().mockResolvedValue(0),
        normalize: vi.fn().mockResolvedValue({ changed: 0 }),
      } as never,
    );

    await expect(coordinator.requestSync()).rejects.toThrow(
      "stale_obsidian_publication",
    );
    expect(settings.cloudPendingPublication).toBeNull();
    expect(settings.cloudStatus).toBe("retryable_error");
    // The dropped intent's removal stays known so the republication deletes it.
    expect(settings.cloudKnownPublishedTaskIds).toContain("gone-task");

    pushSnapshot.mockReset();
    pushSnapshot.mockImplementation(async (intent: CloudPublicationIntent) => ({
      publisher_epoch: intent.publication.publisher_epoch,
      publication_id: intent.publication.publication_id,
      sequence: intent.publication.sequence,
      base_sequence: intent.publication.base_sequence,
    }));
    await coordinator.requestSync();
    expect(pushSnapshot).toHaveBeenCalledTimes(1);
    const republished = pushSnapshot.mock.calls[0][0] as CloudPublicationIntent;
    expect(republished.publication.publication_id).not.toBe("local-publication");
    expect(republished.publication.base_sequence).toBe(2);
    expect(republished.publication.sequence).toBe(3);
    expect(republished.publication.removed_provider_task_ids).toContain(
      "gone-task",
    );
    expect(settings.cloudPublicationSequence).toBe(3);
  });
});

describe("the cycle owner fence", () => {
  it("never publishes into an account signed in mid-cycle", async () => {
    requestUrl.mockReset();
    const settings = baseSettings();
    settings.cloudOwnerUserId = "user-a";
    const sessionA = { accessToken: "token-a", refreshToken: "r-a", expiresAt: Date.now() + 3_600_000, userId: "user-a" };
    const sessionB = { accessToken: "token-b", refreshToken: "r-b", expiresAt: Date.now() + 3_600_000, userId: "user-b" };
    let calls = 0;
    // Cycle start (owner check) and get_my_obsidian_sync_access_v1 see A;
    // the user signs out and back in as B while the cycle is running.
    const getValidSession = vi.fn(async () => (calls++ < 2 ? sessionA : sessionB));
    requestUrl.mockImplementation(async (request: { url: string; body: string }) => {
      const fn = request.url.split("/rpc/")[1];
      if (fn === "get_my_obsidian_sync_access_v1")
        return { status: 200, text: JSON.stringify({ allowed: true, plan_name: "Pro", reason: "" }) };
      if (fn === "list_my_obsidian_publisher_vaults_v1")
        return { status: 200, text: JSON.stringify({ vaults: [] }) };
      if (fn === "publish_my_obsidian_vault_v2")
        return { status: 200, text: JSON.stringify({ vault: { id: "cloud-vault-b", publisher_epoch: "epoch-b" }, publication: { protocol_version: 2, publisher_epoch: "epoch-b", last_sequence: 0 } }) };
      if (fn === "push_my_obsidian_snapshot_v2") {
        const body = JSON.parse(request.body) as { p_publication: CloudPublicationIntent["publication"] };
        return { status: 200, text: JSON.stringify({ publisher_epoch: body.p_publication.publisher_epoch, publication_id: body.p_publication.publication_id, sequence: body.p_publication.sequence, base_sequence: body.p_publication.base_sequence }) };
      }
      if (fn === "list_my_obsidian_pending_operations_v2")
        return { status: 200, text: JSON.stringify({ operations: [] }) };
      return { status: 404, text: "{}" };
    });
    const cloud = new DainvoCloudClient(
      {
        supabaseUrl: "https://example.supabase.co",
        publishableKey: "sb_publishable_test",
        oauthClientId: "client-id",
        oauthRedirectUri: "https://users.dainvo.com/auth/obsidian-callback",
      },
      { getValidSession } as never,
    );
    const coordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: vault(),
        getSettings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getDeviceId: () => "device",
        ensureBridgeIdentityAliasSupport: vi.fn().mockResolvedValue(undefined),
      },
      { getValidSession } as never,
      cloud,
      {
        countBackfillCandidates: vi.fn().mockResolvedValue(0),
        normalize: vi.fn().mockResolvedValue({ changed: 0 }),
      } as never,
    );

    await expect(coordinator.requestSync()).rejects.toThrow("account_changed");

    const byFunction = requestUrl.mock.calls.map((call) => {
      const request = call[0] as { url: string; headers: Record<string, string> };
      return [request.url.split("/rpc/")[1], request.headers.Authorization];
    });
    expect(byFunction.some(([, auth]) => auth === "Bearer token-b")).toBe(false);
    expect(settings.cloudOwnerUserId).toBe("user-a");
    expect(settings.cloudVaultId).not.toBe("cloud-vault-b");
    expect(settings.cloudStatus).toBe("paused_account");
  });

  it("relink rebinds the client, and disable purges only the vault owner", async () => {
    const settings = baseSettings();
    settings.cloudOwnerUserId = "user-a";
    const bindOwner = vi.fn();
    const session = { getValidSession: vi.fn().mockResolvedValue({ userId: "user-b" }) };
    const listPublisherVaults = vi
      .fn()
      .mockRejectedValue(new CloudRelayError("account_changed", 409, false));
    const coordinator = new ObsidianCloudSyncCoordinator(
      {
        vault: vault(),
        getSettings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getDeviceId: () => "device",
        ensureBridgeIdentityAliasSupport: vi.fn().mockResolvedValue(undefined),
      },
      session as never,
      { bindOwner, listPublisherVaults } as never,
      {} as never,
    );

    // Disable while signed in as B never purges A's vault as B.
    await expect(coordinator.disableAndPurge()).rejects.toThrow("account_changed");
    expect(bindOwner).toHaveBeenLastCalledWith("user-a");
    expect(settings.cloudStatus).toBe("disable_pending");

    await coordinator.relinkToCurrentAccount();
    expect(bindOwner).toHaveBeenLastCalledWith("user-b");
    expect(settings.cloudOwnerUserId).toBe("user-b");
  });
});
