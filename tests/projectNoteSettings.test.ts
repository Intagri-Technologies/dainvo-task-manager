import { describe, expect, it } from "vitest";

import {
  normalizeProjectNoteFolder,
  resolveProjectNoteSettings,
} from "../src/projectNoteSettings";
import { DEFAULT_SETTINGS } from "../src/types";

describe("project note settings", () => {
  it("exports the default Projects folder", () => {
    expect(
      resolveProjectNoteSettings(
        DEFAULT_SETTINGS,
        "2026-08-17T12:00:00.000Z",
      ),
    ).toEqual({
      folder: "Projects",
      exportedAt: "2026-08-17T12:00:00.000Z",
    });
  });

  it("normalizes a nested vault-relative folder", () => {
    expect(normalizeProjectNoteFolder("Work\\Projects")).toBe(
      "Work/Projects",
    );
  });

  it("rejects absolute, traversing, and unsafe folders", () => {
    for (const folder of [
      "/Projects",
      "C:\\Projects",
      "Notes/../Projects",
      "Projects/CON",
      "Projects/name.",
      "Projects/name:bad",
    ]) {
      expect(() => normalizeProjectNoteFolder(folder)).toThrow();
    }
  });
});
