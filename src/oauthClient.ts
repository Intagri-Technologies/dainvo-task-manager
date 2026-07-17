import { requestUrl } from "obsidian";

import {
  assertCloudConfig,
  type DainvoCloudConfig,
} from "./runtimeConfig";
import type { DainvoSecureStore } from "./secureStore";
import type { CloudSession, PendingPkce } from "./types";

const PKCE_MAX_AGE_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 2 * 60 * 1000;

export class DainvoOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DainvoOAuthError";
  }
}

export class DainvoOAuthClient {
  constructor(
    private readonly config: DainvoCloudConfig,
    private readonly secrets: DainvoSecureStore,
  ) {}

  async createAuthorizationUrl(): Promise<string> {
    const config = assertCloudConfig(this.config);
    const pending: PendingPkce = {
      state: randomUrlSafe(32),
      verifier: randomUrlSafe(64),
      redirectUri: config.oauthRedirectUri,
      createdAt: Date.now(),
    };
    const challenge = await pkceChallenge(pending.verifier);
    this.secrets.setPendingPkce(pending);

    const url = new URL(`${config.supabaseUrl}/auth/v1/oauth/authorize`);
    url.searchParams.set("client_id", config.oauthClientId);
    url.searchParams.set("redirect_uri", config.oauthRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", pending.state);
    return url.toString();
  }

  async completeAuthorization(params: Record<string, string>): Promise<CloudSession> {
    const safeError = params.error?.trim();
    if (safeError) {
      this.secrets.setPendingPkce(null);
      throw new Error(params.error_description?.trim() || safeError);
    }

    const pending = this.secrets.getPendingPkce();
    if (!pending || Date.now() - pending.createdAt > PKCE_MAX_AGE_MS) {
      this.secrets.setPendingPkce(null);
      throw new Error("The Dainvo sign-in request expired. Please try again.");
    }
    if (!params.state || params.state !== pending.state) {
      this.secrets.setPendingPkce(null);
      throw new Error("The Dainvo sign-in response did not match this request.");
    }
    const code = params.code?.trim();
    if (!code) {
      throw new Error("Dainvo did not return an authorization code.");
    }

    const token = await this.tokenRequest({
      grant_type: "authorization_code",
      client_id: this.config.oauthClientId,
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    });
    this.secrets.setPendingPkce(null);
    const session = sessionFromToken(token);
    this.secrets.setCloudSession(session);
    return session;
  }

  async getValidSession(): Promise<CloudSession | null> {
    const session = this.secrets.getCloudSession();
    if (!session) {
      return null;
    }
    if (session.expiresAt - Date.now() > REFRESH_EARLY_MS) {
      return session;
    }

    try {
      const token = await this.tokenRequest({
        grant_type: "refresh_token",
        client_id: assertCloudConfig(this.config).oauthClientId,
        refresh_token: session.refreshToken,
      });
      const refreshed = sessionFromToken(token, session.refreshToken);
      this.secrets.setCloudSession(refreshed);
      return refreshed;
    } catch (error) {
      if (isTerminalRefreshError(error)) {
        this.secrets.setCloudSession(null);
        throw new DainvoOAuthError(
          "signed_out",
          error.status,
          "Your Dainvo sign-in expired. Please sign in again.",
        );
      }
      throw error;
    }
  }

  async signOut(): Promise<void> {
    const session = this.secrets.getCloudSession();
    if (session) {
      try {
        await requestUrl({
          url: `${assertCloudConfig(this.config).supabaseUrl}/auth/v1/logout?scope=local`,
          method: "POST",
          headers: {
            apikey: this.config.publishableKey,
            Authorization: `Bearer ${session.accessToken}`,
          },
          throw: false,
        });
      } catch {
        // Local sign-out must still complete when offline.
      }
    }
    this.secrets.clearAllCloudSecrets();
  }

  private async tokenRequest(
    fields: Record<string, string>,
  ): Promise<OAuthTokenResponse> {
    const config = assertCloudConfig(this.config);
    const body = new URLSearchParams(fields).toString();
    const response = await requestUrl({
      url: `${config.supabaseUrl}/auth/v1/oauth/token`,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      headers: { apikey: config.publishableKey },
      body,
      throw: false,
    });
    const payload = parseJson(response.text);

    // Supabase changed OAuth token success responses from 201 to 200; accept
    // the protocol contract (any 2xx) instead of a single status code.
    if (response.status < 200 || response.status >= 300) {
      throw new DainvoOAuthError(
        readOAuthErrorCode(payload, response.status),
        response.status,
        readSafeError(payload, "Dainvo sign-in failed."),
      );
    }
    if (!isTokenResponse(payload)) {
      throw new Error("Dainvo returned an invalid OAuth token response.");
    }
    return payload;
  }
}

function isTerminalRefreshError(error: unknown): error is DainvoOAuthError {
  return (
    error instanceof DainvoOAuthError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

function sessionFromToken(
  token: OAuthTokenResponse,
  previousRefreshToken = "",
): CloudSession {
  const userId = readJwtSubject(token.access_token);
  if (!userId) {
    throw new Error("Dainvo returned a token without an account identity.");
  }
  const refreshToken = token.refresh_token?.trim() || previousRefreshToken;
  if (!refreshToken) {
    throw new Error("Dainvo returned a token without offline refresh access.");
  }

  return {
    accessToken: token.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
    userId,
  };
}

function readJwtSubject(token: string): string | null {
  const payloadPart = token.split(".")[1];
  if (!payloadPart) {
    return null;
  }
  try {
    const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" && payload.sub.trim()
      ? payload.sub.trim()
      : null;
  } catch {
    return null;
  }
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function randomUrlSafe(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function isTokenResponse(value: unknown): value is OAuthTokenResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "access_token" in value &&
      typeof (value as { access_token?: unknown }).access_token === "string",
  );
}

function readSafeError(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const payload = value as Record<string, unknown>;
  for (const key of ["error_description", "msg", "message", "error"]) {
    const candidate = payload[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

function readOAuthErrorCode(value: unknown, status: number): string {
  if (value && typeof value === "object") {
    const payload = value as Record<string, unknown>;
    for (const key of ["error", "code"]) {
      const candidate = payload[key];
      if (
        typeof candidate === "string" &&
        /^[a-z0-9_.-]{1,80}$/i.test(candidate)
      ) {
        return candidate.toLowerCase();
      }
    }
  }
  return `oauth_http_${status}`;
}
