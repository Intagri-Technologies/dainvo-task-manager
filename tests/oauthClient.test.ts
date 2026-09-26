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
    const secrets = new DainvoSecureStore(new MemorySecretStorage() as never);
    const client = new DainvoOAuthClient(config, secrets);
    const url = new URL(await client.createAuthorizationUrl());

    expect(url.pathname).toBe("/auth/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("obsidian-client-test");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://users.dainvo.com/auth/obsidian-callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(secrets.getPendingPkce()?.state);
    expect(url.searchParams.get("code_challenge")).not.toContain("=");
  });

  it("rejects mismatched callback state before exchanging a code", async () => {
    const secrets = new DainvoSecureStore(new MemorySecretStorage() as never);
    const client = new DainvoOAuthClient(config, secrets);
    await client.createAuthorizationUrl();

    await expect(
      client.completeAuthorization({
        code: "safe-code",
        state: "wrong-state",
      }),
    ).rejects.toThrow("did not match");
    expect(requestUrl).not.toHaveBeenCalled();
    expect(secrets.getPendingPkce()).not.toBeNull();
  });

  it("accepts any successful 2xx token response and stores refresh data", async () => {
    const secrets = new DainvoSecureStore(new MemorySecretStorage() as never);
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
    const secrets = new DainvoSecureStore(new MemorySecretStorage() as never);
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

  it("does not expose token email claims containing control characters", async () => {
    const secrets = new DainvoSecureStore(new MemorySecretStorage() as never);
    secrets.setCloudSession({
      accessToken: jwtFor(
        "00000000-0000-4000-8000-000000000001",
        "person\n@example.com",
      ),
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      userId: "00000000-0000-4000-8000-000000000001",
    });

    const session = await new DainvoOAuthClient(
      config,
      secrets,
    ).getValidSession();

    expect(session?.email).toBeUndefined();
  });

  it("clears a terminally invalid refresh session and requires sign-in", async () => {
    const secrets = new DainvoSecureStore(new MemorySecretStorage() as never);
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
    await expect(client.getValidSession()).rejects.toThrow("sign-in expired");
    expect(secrets.getCloudSession()).toBeNull();
  });

  it("retains refresh data for a retryable token-server failure", async () => {
    const secrets = new DainvoSecureStore(new MemorySecretStorage() as never);
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
  it("preserves a newer pending sign-in when an old error callback arrives", async () => {
    const { store, first } = lifecycleFixture();
    await first.createAuthorizationUrl();
    const oldState = store.getPendingPkce()!.state;
    await first.createAuthorizationUrl();
    const pending = store.getPendingPkce();
    await expect(
      first.completeAuthorization({ state: oldState, error: "access_denied" }),
    ).rejects.toThrow("did not match");
    expect(store.getPendingPkce()).toEqual(pending);
  });

  it("cannot commit a callback after sign-out through another client", async () => {
    const { store, first, second, request, response } = lifecycleFixture();
    await first.createAuthorizationUrl();
    const state = store.getPendingPkce()!.state;
    const pending = deferred<ReturnType<typeof response>>();
    request.mockReturnValueOnce(pending.promise);
    const connecting = first.completeAuthorization({
      state,
      code: "synthetic-code",
    });
    const rejected = expect(connecting).rejects.toMatchObject({
      code: "request_superseded",
    });
    await second.signOut();
    pending.resolve(
      response(200, {
        access_token: jwtFor("user-old"),
        refresh_token: "old-refresh",
      }),
    );
    await rejected;
    expect(store.getCloudSession()).toBeNull();
  });

  it.each([200, 400])(
    "cannot replace or clear a new account with a late refresh (%s)",
    async (status) => {
      const { store, first, second, request, response } = lifecycleFixture();
      store.setCloudSession(lifecycleSession("old"));
      const pending = deferred<ReturnType<typeof response>>();
      request
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(response(204, {}));
      const refreshing = first.getValidSession();
      const rejected = expect(refreshing).rejects.toMatchObject({
        code: "request_superseded",
      });
      await second.signOut();
      store.setCloudSession(lifecycleSession("new"));
      pending.resolve(
        response(
          status,
          status === 200
            ? { access_token: jwtFor("old"), refresh_token: "rotated-old" }
            : { error: "invalid_grant" },
        ),
      );
      await rejected;
      expect(store.getCloudSession()?.refreshToken).toBe("refresh-new");
    },
  );

  it("clears local state before logout and never clears a later login", async () => {
    const { store, first, request, response } = lifecycleFixture();
    store.setCloudSession(lifecycleSession("old"));
    const pending = deferred<ReturnType<typeof response>>();
    request.mockReturnValueOnce(pending.promise);
    const signingOut = first.signOut();
    expect(store.getCloudSession()).toBeNull();
    store.setCloudSession(lifecycleSession("new"));
    pending.resolve(response(204, {}));
    await signingOut;
    expect(store.getCloudSession()?.refreshToken).toBe("refresh-new");
  });

  it("shares a single refresh between clients using the same backing storage", async () => {
    const { store, first, second, request, response } = lifecycleFixture();
    store.setCloudSession(lifecycleSession("old"));
    const pending = deferred<ReturnType<typeof response>>();
    request.mockReturnValueOnce(pending.promise);
    const one = first.getValidSession();
    const two = second.getValidSession();
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve(
      response(200, { access_token: jwtFor("old"), refresh_token: "rotated" }),
    );
    const results = await Promise.all([one, two]);
    expect(results[0]).toEqual(results[1]);
    expect(store.getCloudSession()?.refreshToken).toBe("rotated");
  });

  it("keeps the original terminal refresh error as the reconnect error cause", async () => {
    const { store, first, request, response } = lifecycleFixture();
    store.setCloudSession(lifecycleSession("old"));
    request.mockResolvedValueOnce(response(400, { error: "invalid_grant" }));
    await expect(first.getValidSession()).rejects.toMatchObject({
      code: "signed_out",
      cause: { code: "invalid_grant", status: 400 },
    });
  });
});

function jwtFor(subject: string, email?: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: subject, email })}.signature`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

function lifecycleSession(userId: string) {
  return {
    userId,
    accessToken: jwtFor(userId),
    refreshToken: `refresh-${userId}`,
    expiresAt: 0,
  };
}

function lifecycleFixture() {
  const backing = new MemorySecretStorage();
  const store = new DainvoSecureStore(backing as never);
  const first = new DainvoOAuthClient(config, store);
  const second = new DainvoOAuthClient(
    config,
    new DainvoSecureStore(backing as never),
  );
  const response = (status: number, value: unknown) => ({
    status,
    text: JSON.stringify(value),
  });
  return { store, first, second, request: requestUrl, response };
}
