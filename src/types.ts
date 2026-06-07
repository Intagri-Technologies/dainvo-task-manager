export type DainvoPluginSettings = {
  bridgeBaseUrl: string;
  pairingCode: string;
  bearerToken: string;
  accountId: string;
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  lastStatus: string;
  lastSnapshotAt: string;
};

export type ObsidianSnapshotTask = {
  providerTaskId: string;
  title: string;
  status: 'open' | 'completed';
  priority: number;
  labels: string[];
  dueAt: string | null;
  completedAt: string | null;
  notePath: string;
  noteTitle: string | null;
  heading: string | null;
  lineNumber: number;
  blockId: string | null;
  lineHash: string;
  rawTaskLine: string;
  openUri: string;
  parserFormat: 'markdown' | 'tasks';
};

export type ObsidianSnapshotPayload = {
  schemaVersion: 1;
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  exportedAt: string;
  tasks: ObsidianSnapshotTask[];
};

export type PairResult = {
  accountId: string;
  token: string;
  baseUrl: string;
};

export type PendingOperation = {
  id: string;
  operationType: 'update' | 'delete' | 'complete' | 'reopen' | 'move';
  task: {
    id: string;
    title: string;
    status: 'open' | 'completed' | 'deleted';
    priority: number;
    labels: string[];
    dueAt: string | null;
  };
  source: ObsidianSnapshotTask;
};

export const DEFAULT_SETTINGS: DainvoPluginSettings = {
  bridgeBaseUrl: '',
  pairingCode: '',
  bearerToken: '',
  accountId: '',
  vaultId: '',
  vaultName: '',
  vaultPath: '',
  lastStatus: 'Not paired',
  lastSnapshotAt: ''
};

