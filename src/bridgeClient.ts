import type {
  DainvoPluginSettings,
  ObsidianSnapshotPayload,
  PairResult,
  PendingOperation
} from './types';

export class DainvoBridgeClient {
  constructor(private readonly getSettings: () => DainvoPluginSettings) {}

  async pair(input: {
    pairingCode: string;
    vaultId: string;
    vaultName: string;
    vaultPath: string;
    pluginVersion: string;
  }): Promise<PairResult> {
    const response = await fetch(
      `${normalizeBaseUrl(this.getSettings().bridgeBaseUrl)}/obsidian/v1/pair`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }
    );

    return parseJsonResponse<PairResult>(response);
  }

  async postSnapshot(payload: ObsidianSnapshotPayload): Promise<void> {
    const response = await fetch(
      `${normalizeBaseUrl(this.getSettings().bridgeBaseUrl)}/obsidian/v1/snapshot`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(payload)
      }
    );

    await parseJsonResponse<unknown>(response);
  }

  async listOperations(): Promise<PendingOperation[]> {
    const response = await fetch(
      `${normalizeBaseUrl(this.getSettings().bridgeBaseUrl)}/obsidian/v1/operations`,
      {
        method: 'GET',
        headers: this.authHeaders()
      }
    );
    const payload = await parseJsonResponse<{ operations: PendingOperation[] }>(
      response
    );

    return payload.operations;
  }

  async ackOperation(
    operationId: string,
    payload: { status: 'succeeded' | 'failed' | 'conflict'; error?: string }
  ): Promise<void> {
    const response = await fetch(
      `${normalizeBaseUrl(this.getSettings().bridgeBaseUrl)}/obsidian/v1/operations/${encodeURIComponent(operationId)}/ack`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(payload)
      }
    );

    await parseJsonResponse<unknown>(response);
  }

  private authHeaders(): Record<string, string> {
    const token = this.getSettings().bearerToken.trim();

    if (!token) {
      throw new Error('Dainvo bridge is not paired.');
    }

    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error('Dainvo bridge URL is required.');
  }

  return trimmed;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error)
        : `Dainvo bridge request failed with ${response.status}.`;
    throw new Error(error);
  }

  return payload as T;
}

