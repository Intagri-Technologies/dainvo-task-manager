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
        publishableKey: "publishable-key",
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
      typeof publishedRequest.body !== "string"
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
  });
});
