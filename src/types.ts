export type DainvoPluginSettings = {
  bridgeBaseUrl: string;
  pairingCode: string;
  bearerToken: string;
  accountId: string;
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  vaultConfigDir: string;
  dailyNoteDateFormat: string;
  dailyNoteFolder: string;
  dailyNoteTemplatePath: string;
  dailyNoteSettingsOverrideEnabled: boolean;
  dailyNoteSectionHeading: string;
  dailyNoteCreateEnabled: boolean;
  lastStatus: string;
  lastSnapshotAt: string;
};

export type DailyNoteSettings = {
  dateFormat: string;
  folder: string;
  templatePath: string | null;
  sectionHeading: string;
  createEnabled: boolean;
  overrideEnabled: boolean;
  exportedAt: string | null;
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
  vaultConfigDir: string;
  dailyNoteSettings: DailyNoteSettings;
  exportedAt: string;
  tasks: ObsidianSnapshotTask[];
};

export type PairResult = {
  accountId: string;
  token: string;
  baseUrl: string;
};

export type PendingMutationOperation = {
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

export type PendingOperation = PendingMutationOperation;

export const DEFAULT_SETTINGS: DainvoPluginSettings = {
  bridgeBaseUrl: '',
  pairingCode: '',
  bearerToken: '',
  accountId: '',
  vaultId: '',
  vaultName: '',
  vaultPath: '',
  vaultConfigDir: '.obsidian',
  dailyNoteDateFormat: '',
  dailyNoteFolder: '',
  dailyNoteTemplatePath: '',
  dailyNoteSettingsOverrideEnabled: false,
  dailyNoteSectionHeading: '## Dainvo',
  dailyNoteCreateEnabled: true,
  lastStatus: 'Not paired',
  lastSnapshotAt: ''
};
