import {
  requestUrl,
  type RequestUrlParam,
  type RequestUrlResponse,
} from "obsidian";

import type {
  DailyNoteSettings,
  DainvoPluginSettings,
  ObsidianSnapshotPayload,
  PairResult,
  PendingOperation
} from './types';

const PREFERRED_BRIDGE_BASE_URLS = [
  'http://127.0.0.1:58234',
  'http://127.0.0.1:58235',
  'http://127.0.0.1:58236',
  'http://127.0.0.1:58237',
  'http://127.0.0.1:58238'
] as const;

export class DainvoBridgeClient {
  constructor(private readonly getSettings: () => DainvoPluginSettings) {}

  async pair(input: {
    pairingCode: string;
    vaultId: string;
    vaultName: string;
    vaultPath: string;
    vaultConfigDir: string;
    pluginVersion: string;
    dailyNoteSettings: DailyNoteSettings;
  }): Promise<PairResult> {
    const response = await requestUrl({
      url: `${normalizeBaseUrl(this.getSettings().bridgeBaseUrl)}/obsidian/v1/pair`,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(input),
      throw: false,
    });

    return parseJsonResponse<PairResult>(response);
  }

  async postSnapshot(payload: ObsidianSnapshotPayload): Promise<void> {
    const response = await this.fetchWithBridgeFailover(
      '/obsidian/v1/snapshot',
      {
        method: "POST",
        contentType: "application/json",
        headers: this.authHeaders(),
        body: JSON.stringify(payload),
      },
    );

    await parseJsonResponse<unknown>(response);
  }

  async listOperations(): Promise<PendingOperation[]> {
    const response = await this.fetchWithBridgeFailover(
      '/obsidian/v1/operations',
      {
        method: "GET",
        headers: this.authHeaders(),
      },
    );
    const payload = await parseJsonResponse<{ operations: PendingOperation[] }>(
      response
    );

    return payload.operations;
  }

  async ackOperation(
    operationId: string,
    payload: { status: "succeeded" | "failed" | "conflict"; error?: string },
  ): Promise<void> {
    const response = await this.fetchWithBridgeFailover(
      `/obsidian/v1/operations/${encodeURIComponent(operationId)}/ack`,
      {
        method: "POST",
        contentType: "application/json",
        headers: this.authHeaders(),
        body: JSON.stringify(payload),
      },
    );

    await parseJsonResponse<unknown>(response);
  }

  private async fetchWithBridgeFailover(
    path: string,
    init: BridgeRequestInit,
  ): Promise<RequestUrlResponse> {
    const settings = this.getSettings();
    const candidates = [
      normalizeBaseUrl(settings.bridgeBaseUrl),
      ...PREFERRED_BRIDGE_BASE_URLS
    ];
    const seen = new Set<string>();
    let lastError: unknown = null;

    for (const baseUrl of candidates) {
      if (seen.has(baseUrl)) {
        continue;
      }
      seen.add(baseUrl);

      try {
        const response = await requestUrl({
          url: `${baseUrl}${path}`,
          ...init,
          throw: false,
        });

        if (isSuccessStatus(response.status) || response.status !== 404) {
          settings.bridgeBaseUrl = baseUrl;
          return response;
        }

        lastError = new Error("Dainvo bridge endpoint was not found.");
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to fetch Dainvo bridge.");
  }

  private authHeaders(): Record<string, string> {
    const token = this.getSettings().bearerToken.trim();

    if (!token) {
      throw new Error("Dainvo bridge is not paired.");
    }

    return {
      Authorization: `Bearer ${token}`,
    };
  }
}

type BridgeRequestInit = Pick<
  RequestUrlParam,
  "method" | "contentType" | "headers" | "body"
>;

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error("Dainvo bridge URL is required.");
  }

  return trimmed;
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

async function parseJsonResponse<T>(
  response: RequestUrlResponse,
): Promise<T> {
  const text = response.text;
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!isSuccessStatus(response.status)) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Dainvo bridge request failed with ${response.status}.`;
    throw new Error(error);
  }

  return payload as T;
}
