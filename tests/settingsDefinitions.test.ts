import { beforeEach, describe, expect, it, vi } from "vitest";

const { Platform } = vi.hoisted(() => ({
  Platform: { isDesktopApp: true },
}));
vi.mock("obsidian", () => ({
  AbstractInputSuggest: class AbstractInputSuggest {},
  Notice: class Notice {},
  Platform,
  TFolder: class TFolder {},
}));

import {
  buildDainvoSettingDefinitions,
  buildDesktopPairingDefinitions,
  buildMobileSyncOptions,
} from "../src/settingsDefinitions";
import { DEFAULT_SETTINGS } from "../src/types";
import type DainvoTaskManagerPlugin from "../src/main";
import type {
  Setting,
  SettingDefinitionItem,
  SettingDefinitionRender,
} from "obsidian";

describe("Dainvo settings definitions", () => {
  beforeEach(() => {
    Platform.isDesktopApp = true;
  });

  it("keeps setting names and aliases across the main sections and connection dialogs", () => {
    const definitions = buildDefinitions(true);
    const rows = flattenRows(definitions);

    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "Dainvo account",
        "Task markers",
        "Mobile task sync",
        "Desktop pairing",
        "Dainvo bridge URL",
        "Use custom Daily Notes settings",
        "Note placement",
        "Projects folder",
      ]),
    );
    expect(findRow(rows, "Dainvo account").aliases).toEqual(
      expect.arrayContaining(["sign in", "sign out"]),
    );
    expect(findRow(rows, "Task markers").aliases).toContain("backfill");
  });

  it("hides desktop-only groups on mobile", () => {
    Platform.isDesktopApp = false;
    const groups = buildDefinitions();

    const rows = flattenRows(groups, true);
    expect(rows.map((row) => row.name)).toContain("Dainvo account");
    expect(rows.map((row) => row.name)).toContain("Task markers");
    expect(rows.map((row) => row.name)).not.toContain("Dainvo bridge URL");
    expect(rows.map((row) => row.name)).not.toContain("Note placement");
    expect(rows.map((row) => row.name)).not.toContain("Projects folder");
  });

  it("tracks cloud-state visibility without rebuilding definitions", () => {
    const { plugin, actions } = createDefinitions();
    const rows = flattenRows(buildMobileSyncOptions(plugin, actions));
    const takeover = findRow(rows, "Another publisher owns this vault");
    const retry = findRow(rows, "Retry sync");

    expect(isVisible(takeover)).toBe(false);
    plugin.settings.cloudStatus = "paused_other_publisher";
    expect(isVisible(takeover)).toBe(true);
    plugin.settings.cloudStatus = "retryable_error";
    expect(isVisible(retry)).toBe(true);
  });

  it("shows only applicable note options as their parent choices change", () => {
    const { definitions, plugin } = createDefinitions();
    const rows = flattenRows(definitions);
    const custom = findRow(rows, "Use custom Daily Notes settings");
    const dateFormat = findRow(rows, "Date format");
    const dedicated = findRow(rows, "Dedicated folder");

    plugin.settings.dailyNoteCreateEnabled = false;
    expect(isVisible(custom)).toBe(false);
    expect(isVisible(dateFormat)).toBe(false);
    plugin.settings.dailyNoteCreateEnabled = true;
    expect(isVisible(custom)).toBe(true);
    expect(isVisible(dateFormat)).toBe(false);
    plugin.settings.dailyNoteSettingsOverrideEnabled = true;
    expect(isVisible(dateFormat)).toBe(true);
    plugin.settings.itemNotePlacement = "daily-note-folder";
    expect(isVisible(dedicated)).toBe(false);
    plugin.settings.itemNotePlacement = "dedicated-folder";
    expect(isVisible(dedicated)).toBe(true);
  });

  it("constructs searchable definitions without vault or network I/O", () => {
    const { plugin } = createDefinitions();

    for (const value of Object.values(plugin)) {
      if (typeof value === "function") {
        expect(value).not.toHaveBeenCalled();
      }
    }
  });

  it("renders every currently visible definition without synchronous errors", () => {
    const definitions = buildDefinitions(true);
    const setting = createSettingStub();

    for (const row of flattenRows(definitions, true)) {
      expect(() => row.render(setting, {} as never)).not.toThrow();
    }
  });
});

function buildDefinitions(includeOptions = false): SettingDefinitionItem[] {
  const { definitions, plugin, actions } = createDefinitions();
  return includeOptions
    ? [...definitions, buildDesktopPairingDefinitions(plugin, actions), ...buildMobileSyncOptions(plugin, actions)]
    : definitions;
}

function createDefinitions(): {
  definitions: SettingDefinitionItem[];
  plugin: DainvoTaskManagerPlugin;
  actions: Parameters<typeof buildDainvoSettingDefinitions>[1];
} {
  const plugin = {
    settings: structuredClone(DEFAULT_SETTINGS),
    isCloudSignedIn: vi.fn(() => false),
    cloudSignedInAccountLabel: vi.fn(() => "person@example.com"),
    refreshCloudAccessStatus: vi.fn(async () => ({
      allowed: true,
      planName: "Pro",
    })),
    signOutCloud: vi.fn(async () => undefined),
    beginCloudSignIn: vi.fn(async () => undefined),
    countStableIdBackfillCandidates: vi.fn(async () => 0),
    syncCloudNow: vi.fn(async () => undefined),
    relinkCloudAccount: vi.fn(async () => undefined),
    disableCloudSync: vi.fn(async () => undefined),
    hasDesktopBridgePairing: vi.fn(() => false),
    saveSettings: vi.fn(async () => undefined),
    pairWithDainvo: vi.fn(async () => undefined),
    unpairDesktopBridge: vi.fn(async () => undefined),
    pushSnapshotNow: vi.fn(async () => undefined),
    resolveDailyNoteSettings: vi.fn(async () => ({
      dateFormat: "YYYY-MM-DD",
      folder: "Daily",
    })),
    copyCurrentDailyNoteSettingsToOverrides: vi.fn(async () => undefined),
    saveItemNoteSettings: vi.fn(async () => undefined),
    resolveItemNoteSettings: vi.fn(),
    saveProjectNoteSettings: vi.fn(async () => undefined),
    resolveProjectNoteSettings: vi.fn(),
  } as unknown as DainvoTaskManagerPlugin;
  const actions = {
    refresh: vi.fn(),
    openDesktopPairing: vi.fn(),
    openMobileSyncOptions: vi.fn(),
    setStableIdMode: vi.fn(),
    enableCloudSync: vi.fn(),
    useThisDeviceAsPublisher: vi.fn(),
    disableCloudSync: vi.fn(),
  };
  const definitions = buildDainvoSettingDefinitions(plugin, actions);
  return { definitions, plugin, actions };
}

function flattenRows(
  items: SettingDefinitionItem[],
  visibleOnly = false,
): SettingDefinitionRender[] {
  return items.flatMap((item) => {
    if (visibleOnly && !isVisible(item)) return [];
    if ("type" in item && (item.type === "group" || item.type === "page")) {
      return flattenRows(item.items ?? [], visibleOnly);
    }
    return "render" in item && item.render ? [item] : [];
  });
}

function findRow(
  rows: SettingDefinitionRender[],
  name: string,
): SettingDefinitionRender {
  const row = rows.find((candidate) => candidate.name === name);
  if (!row) {
    throw new Error(`Missing settings definition: ${name}`);
  }
  return row;
}

function isVisible(
  item: { visible?: boolean | (() => boolean) },
): boolean {
  return typeof item.visible === "function"
    ? item.visible()
    : item.visible !== false;
}

function createSettingStub(): Setting {
  const component = new Proxy(
    {},
    {
      get: () => (..._args: unknown[]) => component,
    },
  );
  const setting = {
    setName: () => setting,
    setDesc: () => setting,
    addButton: (callback: (value: unknown) => void) => {
      callback(component);
      return setting;
    },
    addDropdown: (callback: (value: unknown) => void) => {
      callback(component);
      return setting;
    },
    addText: (callback: (value: unknown) => void) => {
      callback(component);
      return setting;
    },
    addToggle: (callback: (value: unknown) => void) => {
      callback(component);
      return setting;
    },
  };
  return setting as unknown as Setting;
}
