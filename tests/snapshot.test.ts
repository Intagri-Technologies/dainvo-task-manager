import type { Vault } from "obsidian";
import { describe, expect, it } from "vitest";

import { buildSnapshotPayload } from "../src/snapshot";
import { DEFAULT_SETTINGS } from "../src/types";

describe("snapshot item-note contract", () => {
  it("exports item-note settings without changing schema v2 task discovery", async () => {
    const file = { path: "Item Notes/2026/08 - August/Team Sync.md" };
    const vault = {
      getMarkdownFiles: () => [file],
      cachedRead: async () => "- [ ] Follow up from the meeting",
    } as unknown as Vault;

    const payload = await buildSnapshotPayload({
      vault,
      settings: {
        ...DEFAULT_SETTINGS,
        vaultId: "vault-1",
        vaultName: "Work",
        vaultPath: "/vault",
      },
      dailyNoteSettings: {
        dateFormat: "YYYY-MM-DD",
        folder: "Daily",
        templatePath: null,
        sectionHeading: "## Dainvo",
        createEnabled: true,
        overrideEnabled: false,
        exportedAt: "2026-08-14T12:00:00.000Z",
      },
      itemNoteSettings: {
        placement: "dedicated-folder",
        folder: "Item Notes",
        useDayFolder: true,
        includeStartTime: true,
        initialContent: "blank",
        exportedAt: "2026-08-14T12:00:00.000Z",
      },
      projectNoteSettings: {
        folder: "Projects",
        exportedAt: "2026-08-14T12:00:00.000Z",
      },
    });

    expect(payload.schemaVersion).toBe(2);
    expect(payload.itemNoteSettings).toMatchObject({
      placement: "dedicated-folder",
      folder: "Item Notes",
      initialContent: "blank",
    });
    expect(payload.projectNoteSettings).toEqual({
      folder: "Projects",
      exportedAt: "2026-08-14T12:00:00.000Z",
    });
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]).toMatchObject({
      notePath: file.path,
      title: "Follow up from the meeting",
    });
  });
});
