import { describe, expect, it } from 'vitest';

import {
  emptyDailyNoteSettings,
  parseDailyNotesConfig,
  parsePeriodicNotesDailyConfig,
  resolveDailyNoteSettingsFromSources
} from '../src/dailyNotesSettings';
import { DEFAULT_SETTINGS } from '../src/types';

describe('daily note settings resolution', () => {
  it('fills blank plugin fields from the Obsidian core Daily Notes config', () => {
    const resolved = resolveDailyNoteSettingsFromSources({
      settings: {
        ...DEFAULT_SETTINGS,
        dailyNoteSectionHeading: '## Dainvo'
      },
      detected: emptyDailyNoteSettings(),
      coreConfig: {
        dateFormat: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd',
        folder: 'All Daily Notes',
        templatePath: '9 Templates/Template, Daily Note'
      },
      now: new Date('2026-06-07T08:00:00.000Z')
    });

    expect(resolved).toEqual({
      dateFormat: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd',
      folder: 'All Daily Notes',
      templatePath: '9 Templates/Template, Daily Note',
      sectionHeading: '## Dainvo',
      createEnabled: true,
      overrideEnabled: false,
      exportedAt: '2026-06-07T08:00:00.000Z'
    });
  });

  it('keeps live Obsidian settings over stored fallback config values', () => {
    const resolved = resolveDailyNoteSettingsFromSources({
      settings: DEFAULT_SETTINGS,
      detected: {
        dateFormat: '[Journal]/YYYY/MM/DD-dddd',
        folder: 'Detected Daily',
        templatePath: 'Detected/Templates/Daily'
      },
      coreConfig: {
        dateFormat: 'YYYY-MM-DD',
        folder: 'Stored Daily',
        templatePath: 'Stored/Templates/Daily'
      },
      now: new Date('2026-06-07T08:00:00.000Z')
    });

    expect(resolved).toMatchObject({
      dateFormat: '[Journal]/YYYY/MM/DD-dddd',
      folder: 'Detected Daily',
      templatePath: 'Detected/Templates/Daily'
    });
  });

  it('uses automatic Obsidian settings even when stale override fields exist but override mode is off', () => {
    const resolved = resolveDailyNoteSettingsFromSources({
      settings: {
        ...DEFAULT_SETTINGS,
        dailyNoteDateFormat: 'YYYY-MM-DD',
        dailyNoteFolder: 'Stale manual folder',
        dailyNoteTemplatePath: 'Stale/Template.md',
        dailyNoteSettingsOverrideEnabled: false,
        dailyNoteSectionHeading: '## Tasks'
      },
      detected: {
        dateFormat: 'YYYY/MM/DD',
        folder: 'Detected',
        templatePath: 'Detected/Template.md'
      },
      coreConfig: {
        dateFormat: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd',
        folder: 'All Daily Notes',
        templatePath: '9 Templates/Template, Daily Note'
      },
      now: new Date('2026-06-07T08:00:00.000Z')
    });

    expect(resolved).toMatchObject({
      dateFormat: 'YYYY/MM/DD',
      folder: 'Detected',
      templatePath: 'Detected/Template.md',
      sectionHeading: '## Tasks'
    });
  });

  it('keeps explicit plugin settings over detected and core config values when override mode is on', () => {
    const resolved = resolveDailyNoteSettingsFromSources({
      settings: {
        ...DEFAULT_SETTINGS,
        dailyNoteDateFormat: 'YYYY-MM-DD',
        dailyNoteFolder: 'Dailies',
        dailyNoteTemplatePath: 'Templates/Daily.md',
        dailyNoteSettingsOverrideEnabled: true,
        dailyNoteSectionHeading: '## Tasks'
      },
      detected: {
        dateFormat: 'YYYY/MM/DD',
        folder: 'Detected',
        templatePath: 'Detected/Template.md'
      },
      coreConfig: {
        dateFormat: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd',
        folder: 'All Daily Notes',
        templatePath: '9 Templates/Template, Daily Note'
      },
      now: new Date('2026-06-07T08:00:00.000Z')
    });

    expect(resolved).toMatchObject({
      dateFormat: 'YYYY-MM-DD',
      folder: 'Dailies',
      templatePath: 'Templates/Daily.md',
      overrideEnabled: true,
      sectionHeading: '## Tasks'
    });
  });

  it('disables create when Obsidian has no active Daily Notes capability', () => {
    const resolved = resolveDailyNoteSettingsFromSources({
      settings: DEFAULT_SETTINGS,
      detected: emptyDailyNoteSettings(),
      coreConfig: {
        dateFormat: 'YYYY-MM-DD',
        folder: 'Stored Daily',
        templatePath: null
      },
      dailyNotesEnabled: false,
      now: new Date('2026-06-07T08:00:00.000Z')
    });

    expect(resolved).toMatchObject({
      dateFormat: 'YYYY-MM-DD',
      folder: 'Stored Daily',
      createEnabled: false
    });
  });

  it('keeps create disabled when the Dainvo plugin toggle is off even if Daily Notes is active', () => {
    const resolved = resolveDailyNoteSettingsFromSources({
      settings: {
        ...DEFAULT_SETTINGS,
        dailyNoteCreateEnabled: false
      },
      detected: {
        dateFormat: 'YYYY-MM-DD',
        folder: 'Daily',
        templatePath: null
      },
      coreConfig: emptyDailyNoteSettings(),
      dailyNotesEnabled: true,
      now: new Date('2026-06-07T08:00:00.000Z')
    });

    expect(resolved).toMatchObject({
      folder: 'Daily',
      createEnabled: false
    });
  });

  it('parses Obsidian core Daily Notes config fields', () => {
    expect(
      parseDailyNotesConfig({
        format: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd',
        folder: 'All Daily Notes',
        template: '9 Templates/Template, Daily Note'
      })
    ).toEqual({
      dateFormat: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd',
      folder: 'All Daily Notes',
      templatePath: '9 Templates/Template, Daily Note'
    });
  });

  it('parses enabled Periodic Notes daily settings', () => {
    expect(
      parsePeriodicNotesDailyConfig({
        daily: {
          enabled: true,
          format: '[daily]/YYYY/MM/YYYY-MM-DD',
          folder: 'Periodic',
          template: 'Templates/Periodic Daily'
        }
      })
    ).toEqual({
      dateFormat: '[daily]/YYYY/MM/YYYY-MM-DD',
      folder: 'Periodic',
      templatePath: 'Templates/Periodic Daily'
    });
  });

  it('uses the Obsidian default daily format when Periodic Notes daily settings are enabled without a custom format', () => {
    expect(
      parsePeriodicNotesDailyConfig({
        daily: {
          enabled: true
        }
      })
    ).toEqual({
      dateFormat: 'YYYY-MM-DD',
      folder: '',
      templatePath: null
    });
  });

  it('ignores disabled Periodic Notes daily settings', () => {
    expect(
      parsePeriodicNotesDailyConfig({
        daily: {
          enabled: false,
          format: 'YYYY-MM-DD',
          folder: 'Periodic',
          template: 'Templates/Periodic Daily'
        }
      })
    ).toEqual(emptyDailyNoteSettings());
  });
});
