import { requestUrl } from "obsidian";

import {
  assertCloudConfig,
  type DainvoCloudConfig,
} from "./runtimeConfig";
import type { DainvoOAuthClient } from "./oauthClient";
import type {
  CloudPendingOperation,
  CloudPublisherVault,
  CloudSyncAccess,
  CloudTaskProjection,
  StableIdMode,
} from "./types";

export class CloudRelayError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "CloudRelayError";
  }
}
export class DainvoCloudClient {
  constructor(
    private readonly config: DainvoCloudConfig,
    private readonly oauth: DainvoOAuthClient,
  ) {}

  getAccess(): Promise<CloudSyncAccess> {
    return this.rpc<CloudSyncAccess>("get_my_obsidian_sync_access_v1");
  }

  async listPublisherVaults(): Promise<CloudPublisherVault[]> {
    const result = await this.rpc<{ vaults: CloudPublisherVault[] }>(
      "list_my_obsidian_publisher_vaults_v1",
    );
    return Array.isArray(result.vaults) ? result.vaults : [];
  }

  async publishVault(input: {
    vaultId: string;
    vaultName: string;
    deviceId: string;
    identityMode: StableIdMode;
    takeover: boolean;
  }): Promise<CloudPublisherVault> {
    const result = await this.rpc<{ vault: CloudPublisherVault }>(
      "publish_my_obsidian_vault_v1",
      {
        p_vault: {
          vault_id: input.vaultId,
          vault_name: input.vaultName,
          device_id: input.deviceId,
          publisher_kind: "obsidian_plugin",
          identity_mode: input.identityMode,
          operation_capabilities: ["complete", "reopen", "delete"],
          takeover: input.takeover,
        },
      },
    );
    return result.vault;
  }

  pushSnapshot(input: {
    cloudVaultId: string;
    deviceId: string;
    upserts: CloudTaskProjection[];
    presentProviderTaskIds: string[];
    publishedAt: string;
  }): Promise<{
    upserted_count: number;
    deleted_count: number;
    migrated_identity_count?: number;
    active_task_count: number;
    completed_task_count: number;
  }> {
    return this.rpc("push_my_obsidian_snapshot_v1", {
      p_vault_id: input.cloudVaultId,
      p_device_id: input.deviceId,
      p_upserts: input.upserts,
      p_present_provider_task_ids: input.presentProviderTaskIds,
      p_vault_status: "online",
      p_published_at: input.publishedAt,
    });
  }

  async listPendingOperations(cloudVaultId: string): Promise<CloudPendingOperation[]> {
    const result = await this.rpc<{ operations: CloudPendingOperation[] }>(
      "list_my_obsidian_pending_operations_v1",
      { p_vault_id: cloudVaultId, p_limit: 100 },
    );
    return Array.isArray(result.operations) ? result.operations : [];
  }

  resolveOperations(
    resolutions: Array<{
      operation_id: string;
      status: "applied" | "conflict" | "rejected";
      result?: Record<string, unknown>;
    }>,
  ): Promise<{ resolved: number; skipped: number }> {
    return this.rpc("resolve_my_obsidian_operations_v1", {
      p_resolutions: resolutions,
    });
  }

  disableVault(cloudVaultId: string): Promise<{
    found: boolean;
    purged_tasks: number;
  }> {
    return this.rpc("disable_my_obsidian_vault_v1", {
      p_vault_id: cloudVaultId,
      p_purge: true,
    });
  }

  private async rpc<T>(
    functionName: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const config = assertCloudConfig(this.config);
    const session = await this.oauth.getValidSession();
    if (!session) {
      throw new CloudRelayError("signed_out", 401, false);
    }

    let response;
    try {
      response = await requestUrl({
        url: `${config.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
        method: "POST",
        contentType: "application/json",
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(params),
        throw: false,
      });
    } catch {
      throw new CloudRelayError("network_unavailable", 0, true);
    }

    const payload = parseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
      const code = relayErrorCode(payload, response.status);
      throw new CloudRelayError(
        code,
        response.status,
        response.status === 0 || response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    return payload as T;
  }
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function relayErrorCode(value: unknown, status: number): string {
  if (value && typeof value === "object") {
    const payload = value as Record<string, unknown>;
    for (const key of ["message", "code", "error"]) {
      const candidate = payload[key];
      if (typeof candidate === "string" && /^[a-z0-9_ -]{1,120}$/i.test(candidate)) {
        return candidate.trim().toLowerCase().replace(/\s+/g, "_");
      }
    }
  }
  return `relay_http_${status}`;
}
