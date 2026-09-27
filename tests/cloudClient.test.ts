import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock("obsidian", () => ({ requestUrl }));

import { DainvoCloudClient } from "../src/cloudClient";

describe("DainvoCloudClient", () => {
  beforeEach(() => {
    requestUrl.mockReset();
  });

  it("sends the exact confirmed cloud UUID as a replacement precondition", async () => {
    requestUrl.mockResolvedValue({
      status: 200,
      text: JSON.stringify({
        vault: { id: "new-cloud-vault" },
        replaced_vault_id: "956c6b9e-b46a-4b85-bf76-4f4361f1b219",
        purged_task_count: 25,
        discarded_operation_count: 2,
      }),
    });
    const client = new DainvoCloudClient(
      {
        supabaseUrl: "https://example.supabase.co",
        publishableKey: "sb_publishable_test",
        oauthClientId: "client-id",
        oauthRedirectUri: "https://users.dainvo.com/auth/obsidian-callback",
      },
      {
        getValidSession: vi.fn(async () => ({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: Date.now() + 60_000,
          userId: "user-id",
        })),
      } as never,
    );

    const result = await client.publishVault({
      vaultId: "obsidian-stable-vault",
      vaultName: "Notes",
      deviceId: "device-id",
      identityMode: "backfill_and_future",
      takeover: false,
      replaceVaultId: "956c6b9e-b46a-4b85-bf76-4f4361f1b219",
    });

    expect(result).toEqual(
      expect.objectContaining({
        replaced_vault_id: "956c6b9e-b46a-4b85-bf76-4f4361f1b219",
        purged_task_count: 25,
        discarded_operation_count: 2,
      }),
    );
    const publishedRequest: unknown = requestUrl.mock.calls.at(0)?.at(0);
    if (
      !publishedRequest ||
      typeof publishedRequest !== "object" ||
      !("body" in publishedRequest) ||
      typeof publishedRequest.body !== "string" ||
      !("url" in publishedRequest) ||
      typeof publishedRequest.url !== "string"
    ) {
      throw new Error("Expected publish request body.");
    }
    expect(JSON.parse(publishedRequest.body)).toEqual({
      p_vault: {
        vault_id: "obsidian-stable-vault",
        vault_name: "Notes",
        device_id: "device-id",
        publisher_kind: "obsidian_plugin",
        identity_mode: "backfill_and_future",
        operation_capabilities: ["complete", "reopen", "delete"],
        takeover: false,
        replace_vault_id: "956c6b9e-b46a-4b85-bf76-4f4361f1b219",
      },
    });
    expect(publishedRequest.url).toContain(
      "/rpc/publish_my_obsidian_vault_v2",
    );
  });

  it("sends ordered publication envelopes to the v2 snapshot RPC", async () => {
    requestUrl.mockResolvedValue({
      status: 200,
      text: JSON.stringify({
        publication_schema_version: 2,
        publisher_epoch: "publisher-epoch",
        publication_id: "00000000-0000-4000-8000-000000000001",
        sequence: 1,
        base_sequence: 0,
      }),
    });
    const client = new DainvoCloudClient(
      {
        supabaseUrl: "https://example.supabase.co",
        publishableKey: "sb_publishable_test",
        oauthClientId: "client-id",
        oauthRedirectUri: "https://users.dainvo.com/auth/obsidian-callback",
      },
      {
        getValidSession: vi.fn(async () => ({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: Date.now() + 60_000,
          userId: "user-id",
        })),
      } as never,
    );
    const publication = {
      schema_version: 2 as const,
      publisher_epoch: "publisher-epoch",
      publication_id: "00000000-0000-4000-8000-000000000001",
      sequence: 1,
      base_sequence: 0,
      publication_digest: "a".repeat(64),
      capabilities: [
        "ordered_publication",
        "explicit_source_deletion",
        "coverage_counts",
      ] as const,
      coverage: {
        source_inventory_complete: true,
        source_inventory_digest: "b".repeat(64),
        active: { eligible_count: 0, selected_count: 0, omitted_count: 0 },
        completed: {
          eligible_count: 0,
          selected_count: 0,
          omitted_count: 0,
        },
        retained_target_count: 0,
      },
      removed_provider_task_ids: [],
    };

    await client.pushSnapshot({
      cloudVaultId: "cloud-vault",
      deviceId: "device-id",
      publication,
      upserts: [],
      presentProviderTaskIds: [],
      publishedAt: "2026-09-26T20:00:00.000Z",
    });

    const request = requestUrl.mock.calls.at(0)?.at(0) as {
      url: string;
      body: string;
    };
    expect(request.url).toContain("/rpc/push_my_obsidian_snapshot_v2");
    expect(JSON.parse(request.body)).toEqual(
      expect.objectContaining({ p_publication: publication }),
    );
  });
});
