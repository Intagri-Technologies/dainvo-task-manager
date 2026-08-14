import { describe, expect, it } from "vitest";

import {
  normalizeItemNoteFolder,
  resolveItemNoteSettings,
} from "../src/itemNoteSettings";
import { DEFAULT_SETTINGS } from "../src/types";

describe("item note settings", () => {
  it("exports the default backward-compatible settings", () => {
    expect(
      resolveItemNoteSettings(DEFAULT_SETTINGS, "2026-08-14T12:00:00.000Z"),
    ).toEqual({
      placement: "daily-note-folder",
      folder: "Item Notes",
      useDayFolder: false,
      includeStartTime: false,
      initialContent: "title-heading",
      exportedAt: "2026-08-14T12:00:00.000Z",
    });
  });

  it("exports dedicated placement and blank initial content", () => {
    expect(
      resolveItemNoteSettings(
        {
          ...DEFAULT_SETTINGS,
          itemNotePlacement: "dedicated-folder",
          itemNoteFolder: "Notes/Calendar Items",
          itemNoteUseDayFolder: true,
          itemNoteIncludeStartTime: true,
          itemNoteInitialContent: "blank",
        },
        "2026-08-14T12:00:00.000Z",
      ),
    ).toMatchObject({
      placement: "dedicated-folder",
      folder: "Notes/Calendar Items",
      useDayFolder: true,
      includeStartTime: true,
      initialContent: "blank",
    });
  });

  it("suppresses day folders outside dedicated mode", () => {
    expect(
      resolveItemNoteSettings({
        ...DEFAULT_SETTINGS,
        itemNoteUseDayFolder: true,
      }).useDayFolder,
    ).toBe(false);
  });

  it("rejects absolute and traversing folders", () => {
    expect(() => normalizeItemNoteFolder("/Item Notes")).toThrow(
      "relative to the vault",
    );
    expect(() => normalizeItemNoteFolder("C:\\Item Notes")).toThrow(
      "relative to the vault",
    );
    expect(() => normalizeItemNoteFolder("Notes/../Outside")).toThrow(
      "cross-platform safe",
    );
  });

  it("rejects folder segments that are unsafe on supported filesystems", () => {
    for (const folder of [
      "Notes/CON",
      "Notes/ends-with-dot.",
      "Notes/meeting:notes",
      `Notes/${"é".repeat(101)}`,
    ]) {
      expect(() => normalizeItemNoteFolder(folder)).toThrow(
        "cross-platform safe",
      );
    }
  });
});
