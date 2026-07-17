import type { SecretStorage } from "obsidian";

import { sha256 } from "./sha256";
import type { CloudSession, PendingPkce } from "./types";

const CLOUD_SESSION_SECRET = "dainvo-task-manager-cloud-session";
const PKCE_SECRET = "dainvo-task-manager-pkce";
const DEVICE_ID_SECRET = "dainvo-task-manager-device-id";

export class DainvoSecureStore {
  constructor(private readonly storage: SecretStorage) {}

  getCloudSession(): CloudSession | null {
    return this.getJson<CloudSession>(CLOUD_SESSION_SECRET);
  }

  setCloudSession(session: CloudSession | null): void {
    this.setJson(CLOUD_SESSION_SECRET, session);
  }

  getPendingPkce(): PendingPkce | null {
    return this.getJson<PendingPkce>(PKCE_SECRET);
  }

  setPendingPkce(pending: PendingPkce | null): void {
    this.setJson(PKCE_SECRET, pending);
  }

  getOrCreateDeviceId(): string {
    const current = this.storage.getSecret(DEVICE_ID_SECRET)?.trim();
    if (current) {
      return current;
    }

    if (typeof globalThis.crypto?.randomUUID !== "function") {
      throw new Error("Secure random UUID generation is unavailable.");
    }
    const next = globalThis.crypto.randomUUID();
    this.storage.setSecret(DEVICE_ID_SECRET, next);
    return next;
  }

  getBridgeToken(vaultId: string): string {
    return this.storage.getSecret(bridgeSecretId(vaultId))?.trim() ?? "";
  }

  setBridgeToken(vaultId: string, token: string | null): void {
    this.storage.setSecret(bridgeSecretId(vaultId), token?.trim() ?? "");
  }

  migrateLegacyBridgeToken(vaultId: string, token: string): boolean {
    const normalized = token.trim();
    if (!normalized) {
      return false;
    }
    this.setBridgeToken(vaultId, normalized);
    return true;
  }

  clearAllCloudSecrets(): void {
    this.setCloudSession(null);
    this.setPendingPkce(null);
  }

  private getJson<T>(id: string): T | null {
    const value = this.storage.getSecret(id);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      this.storage.setSecret(id, "");
      return null;
    }
  }

  private setJson(id: string, value: unknown | null): void {
    this.storage.setSecret(id, value === null ? "" : JSON.stringify(value));
  }
}
function bridgeSecretId(vaultId: string): string {
  return `dainvo-task-manager-bridge-${sha256(vaultId).slice(0, 20)}`;
}
