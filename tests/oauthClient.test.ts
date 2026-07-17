import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl }));

import { DainvoOAuthClient } from "../src/oauthClient";
import { DainvoSecureStore } from "../src/secureStore";

class MemorySecretStorage {
  private readonly values = new Map<string, string>();

  setSecret(id: string, value: string): void {
    this.values.set(id, value);
  }

  getSecret(id: string): string | null {
    return this.values.get(id) ?? null;
  }

  listSecrets(): string[] {
    return [...this.values.keys()];
  }
}

const config = {
  supabaseUrl: "https://example.supabase.co",
  publishableKey: "sb_publishable_test",
  oauthClientId: "obsidian-client-test",
  oauthRedirectUri: "https://users.dainvo.com/auth/obsidian-callback",
};

describe("Dainvo OAuth PKCE client", () => {
  beforeEach(() => requestUrl.mockReset());

  it("creates a state-bound S256 authorization request", async () => {
    const secrets = new DainvoSecureStore(
      new MemorySecretStorage() as never,
    );
    const client = new DainvoOAuthClient(config, secrets);
    const url = new URL(await client.createAuthorizationUrl());

    expect(url.pathname).toBe("/auth/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("obsidian-client-test");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://users.dainvo.com/auth/obsidian-callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(
      secrets.getPendingPkce()?.state,
    );
    expect(url.searchParams.get("code_challenge")).not.toContain("=");
  });

  it("rejects mismatched callback state before exchanging a code", async () => {
    const secrets = new DainvoSecureStore(
      new MemorySecretStorage() as never,
    );
    const client = new DainvoOAuthClient(config, secrets);
    await client.createAuthorizationUrl();

    await expect(
      client.completeAuthorization({
        code: "safe-code",
        state: "wrong-state",
      }),
    ).rejects.toThrow("did not match");
    expect(requestUrl).not.toHaveBeenCalled();
    expect(secrets.getPendingPkce()).toBeNull();
  });

  it("accepts any successful 2xx token response and stores refresh data", async () => {
    const secrets = new DainvoSecureStore(
      new MemorySecretStorage() as never,
    );
    const client = new DainvoOAuthClient(config, secrets);
    await client.createAuthorizationUrl();
    const state = secrets.getPendingPkce()?.state ?? "";
    requestUrl.mockResolvedValue({
      status: 200,
      text: JSON.stringify({
        access_token: jwtFor(
          "00000000-0000-4000-8000-000000000001",
          "person@example.com",
        ),
        refresh_token: "refresh-token",
        expires_in: 3600,
      }),
    });

    const session = await client.completeAuthorization({
      code: "authorization-code",
      state,
    });

    expect(session.userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(session.email).toBe("person@example.com");
    expect(secrets.getCloudSession()?.refreshToken).toBe("refresh-token");
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.supabase.co/auth/v1/oauth/token",
        method: "POST",
      }),
    );
  });

  it("backfills the display email for an existing stored session", async () => {
    const secrets = new DainvoSecureStore(
      new MemorySecretStorage() as never,
    );
    secrets.setCloudSession({
      accessToken: jwtFor(
        "00000000-0000-4000-8000-000000000001",
        "existing@example.com",
      ),
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      userId: "00000000-0000-4000-8000-000000000001",
    });

    const client = new DainvoOAuthClient(config, secrets);
    const session = await client.getValidSession();

    expect(session?.email).toBe("existing@example.com");
    expect(secrets.getCloudSession()?.email).toBe("existing@example.com");
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("clears a terminally invalid refresh session and requires sign-in", async () => {
    const secrets = new DainvoSecureStore(
      new MemorySecretStorage() as never,
    );
    secrets.setCloudSession({
      accessToken: jwtFor("00000000-0000-4000-8000-000000000001"),
      refreshToken: "expired-refresh-token",
      expiresAt: 0,
      userId: "00000000-0000-4000-8000-000000000001",
    });
    requestUrl.mockResolvedValue({
      status: 400,
      text: JSON.stringify({ error: "invalid_grant" }),
    });

    const client = new DainvoOAuthClient(config, secrets);
    await expect(client.getValidSession()).rejects.toThrow(
      "sign-in expired",
    );
    expect(secrets.getCloudSession()).toBeNull();
  });

  it("retains refresh data for a retryable token-server failure", async () => {
    const secrets = new DainvoSecureStore(
      new MemorySecretStorage() as never,
    );
    secrets.setCloudSession({
      accessToken: jwtFor("00000000-0000-4000-8000-000000000001"),
      refreshToken: "retryable-refresh-token",
      expiresAt: 0,
      userId: "00000000-0000-4000-8000-000000000001",
    });
    requestUrl.mockResolvedValue({
      status: 503,
      text: JSON.stringify({ error: "temporarily_unavailable" }),
    });

    const client = new DainvoOAuthClient(config, secrets);
    await expect(client.getValidSession()).rejects.toThrow(
      "temporarily_unavailable",
    );
    expect(secrets.getCloudSession()?.refreshToken).toBe(
      "retryable-refresh-token",
    );
  });
});

function jwtFor(subject: string, email?: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: subject, email })}.signature`;
}
