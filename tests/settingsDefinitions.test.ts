import { beforeEach, describe, expect, it, vi } from "vitest";

const { Platform } = vi.hoisted(() => ({
  Platform: { isDesktopApp: true },
}));
vi.mock("obsidian", () => ({
  Notice: class Notice {},
  Platform,
}));

import { buildDainvoSettingDefinitions } from "../src/settingsDefinitions";
import { DEFAULT_SETTINGS } from "../src/types";
import type DainvoTaskManagerPlugin from "../src/main";
import type {
  Setting,
  SettingDefinitionGroup,
  SettingDefinitionRender,
} from "obsidian";

describe("Dainvo settings definitions", () => {
  beforeEach(() => {
    Platform.isDesktopApp = true;
  });

  it("indexes stable names and aliases for user-facing settings", () => {
    const definitions = buildDefinitions();
    const rows = flattenRows(definitions);

    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "Dainvo account",
        "Stable-ID mode",
        "Mobile task sync",
        "Dainvo bridge URL",
        "Override Obsidian Daily Notes settings",
        "Note placement",
      ]),
    );
    expect(findRow(rows, "Dainvo account").aliases).toEqual(
      expect.arrayContaining(["sign in", "sign out"]),
    );
    expect(findRow(rows, "Stable-ID mode").aliases).toContain("backfill");
  });

  it("hides desktop-only groups on mobile", () => {
    Platform.isDesktopApp = false;
    const groups = buildDefinitions();

    expect(isVisible(groups[0])).toBe(true);
    expect(groups.slice(1).every((group) => !isVisible(group))).toBe(true);
  });

  it("tracks cloud-state visibility without rebuilding definitions", () => {
    const { definitions, plugin } = createDefinitions();
    const rows = flattenRows(definitions);
    const takeover = findRow(rows, "Another publisher owns this vault");
    const retry = findRow(rows, "Retry sync");

    expect(isVisible(takeover)).toBe(false);
    plugin.settings.cloudStatus = "paused_other_publisher";
    expect(isVisible(takeover)).toBe(true);
    plugin.settings.cloudStatus = "retryable_error";
    expect(isVisible(retry)).toBe(true);
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
    const definitions = buildDefinitions();
    const setting = createSettingStub();

    for (const group of definitions.filter(isVisible)) {
      for (const row of flattenRows([group]).filter(isVisible)) {
        expect(() => row.render(setting, {} as never)).not.toThrow();
      }
    }
  });
});

function buildDefinitions(): SettingDefinitionGroup[] {
  return createDefinitions().definitions;
}

function createDefinitions(): {
  definitions: SettingDefinitionGroup[];
  plugin: DainvoTaskManagerPlugin;
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
  } as unknown as DainvoTaskManagerPlugin;
  const definitions = buildDainvoSettingDefinitions(plugin, {
    refresh: vi.fn(),
    setStableIdMode: vi.fn(),
    enableCloudSync: vi.fn(),
    useThisDeviceAsPublisher: vi.fn(),
    disableCloudSync: vi.fn(),
  }) as SettingDefinitionGroup[];
  return { definitions, plugin };
}

function flattenRows(
  groups: SettingDefinitionGroup[],
): SettingDefinitionRender[] {
  return groups.flatMap(
    (group) => (group.items ?? []) as SettingDefinitionRender[],
  );
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
  item: Pick<SettingDefinitionGroup | SettingDefinitionRender, "visible">,
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
