import type { DailyNoteSettings, DainvoPluginSettings } from './types';

const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD';

export type DetectedDailyNoteSettings = {
  dateFormat: string;
  folder: string;
  templatePath: string | null;
};

export function resolveDailyNoteSettingsFromSources(input: {
  settings: DainvoPluginSettings;
  detected: DetectedDailyNoteSettings;
  coreConfig: DetectedDailyNoteSettings;
  dailyNotesEnabled?: boolean;
  now?: Date;
}): DailyNoteSettings {
  const overrideEnabled = input.settings.dailyNoteSettingsOverrideEnabled;
  const dateFormat =
    (overrideEnabled ? input.settings.dailyNoteDateFormat.trim() : '') ||
    input.detected.dateFormat ||
    input.coreConfig.dateFormat ||
    DEFAULT_DAILY_NOTE_FORMAT;
  const folder =
    (overrideEnabled ? input.settings.dailyNoteFolder.trim() : '') ||
    input.detected.folder ||
    input.coreConfig.folder ||
    '';
  const templatePath =
    (overrideEnabled ? input.settings.dailyNoteTemplatePath.trim() : '') ||
    input.detected.templatePath ||
    input.coreConfig.templatePath ||
    null;
  const sectionHeading =
    input.settings.dailyNoteSectionHeading.trim() || '## Dainvo';

  return {
    dateFormat,
    folder: normalizeVaultPath(folder),
    templatePath: templatePath ? normalizeVaultPath(templatePath) : null,
    sectionHeading,
    createEnabled:
      input.settings.dailyNoteCreateEnabled && input.dailyNotesEnabled !== false,
    overrideEnabled,
    exportedAt: (input.now ?? new Date()).toISOString()
  };
}

export function parseDailyNotesConfig(
  value: unknown
): DetectedDailyNoteSettings {
  if (!value || typeof value !== 'object') {
    return emptyDailyNoteSettings();
  }

  const record = value as Record<string, unknown>;

  return {
    dateFormat: stringSetting(record.format),
    folder: stringSetting(record.folder),
    templatePath: stringSetting(record.template) || null
  };
}

export function parsePeriodicNotesDailyConfig(
  value: unknown
): DetectedDailyNoteSettings {
  if (!value || typeof value !== 'object') {
    return emptyDailyNoteSettings();
  }

  const record = value as Record<string, unknown>;
  const daily =
    record.daily && typeof record.daily === 'object'
      ? (record.daily as Record<string, unknown>)
      : null;

  if (!daily || daily.enabled !== true) {
    return emptyDailyNoteSettings();
  }

  return {
    dateFormat: stringSetting(daily.format) || DEFAULT_DAILY_NOTE_FORMAT,
    folder: stringSetting(daily.folder),
    templatePath: stringSetting(daily.template) || null
  };
}

export function emptyDailyNoteSettings(): DetectedDailyNoteSettings {
  return {
    dateFormat: '',
    folder: '',
    templatePath: null
  };
}

export function normalizeVaultPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
