import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  normalizePath: (value: string) => value.replace(/\\/g, "/"),
}));

let applyIntentsToContent: typeof import("../src/stableIds").applyIntentsToContent;
let StableIdCoordinator: typeof import("../src/stableIds").StableIdCoordinator;
let DEFAULT_SETTINGS: typeof import("../src/types").DEFAULT_SETTINGS;

beforeAll(async () => {
  ({ applyIntentsToContent, StableIdCoordinator } = await import("../src/stableIds"));
  ({ DEFAULT_SETTINGS } = await import("../src/types"));
});

describe("stable ID journaling", () => {
  it("appends an ID to the exact revalidated task and preserves line endings", () => {
    const content = "# Tasks\r\n- [ ] Ship direct sync\r\n";
    const line = "- [ ] Ship direct sync";

    expect(
      applyIntentsToContent(content, [
        {
          notePath: "Tasks.md",
          lineNumber: 2,
          expectedLineHash:
            "cad90bd03e1ef132b9e0b0d3e61f80aba00a254fa4ba2778dd3ba18ecf19444a",
          newBlockId: "dainvo-11111111-1111-4111-8111-111111111111",
          previousNotePath: "Tasks.md",
          previousLineNumber: 2,
          replaceBlockId: null,
        },
      ]),
    ).toBe(
      `# Tasks\r\n${line} ^dainvo-11111111-1111-4111-8111-111111111111\r\n`,
    );
  });

  it("repairs a later duplicate while preserving the first owner", () => {
    const content = [
      "- [ ] First ^shared",
      "- [ ] Copied ^shared",
    ].join("\n");

    expect(
      applyIntentsToContent(content, [
        {
          notePath: "Tasks.md",
          lineNumber: 2,
          expectedLineHash:
            "1ad8c0a109939e39797e049efcfd3e1ab1cdcde24d15527f595c906f47d74ac8",
          newBlockId: "dainvo-22222222-2222-4222-8222-222222222222",
          previousNotePath: null,
          previousLineNumber: null,
          replaceBlockId: "shared",
        },
      ]),
    ).toBe(
      "- [ ] First ^shared\n- [ ] Copied ^dainvo-22222222-2222-4222-8222-222222222222",
    );
  });

  it("rejects a changed line instead of inserting an ID by guesswork", () => {
    expect(() =>
      applyIntentsToContent("- [ ] User changed this task", [
        {
          notePath: "Tasks.md",
          lineNumber: 1,
          expectedLineHash: "not-the-current-hash",
          newBlockId: "dainvo-33333333-3333-4333-8333-333333333333",
          previousNotePath: "Tasks.md",
          previousLineNumber: 1,
          replaceBlockId: null,
        },
      ]),
    ).toThrow("stable_id_task_changed");
  });

  it.each([
    ["frontmatter", "---\n- [ ] Ship direct sync\n---"],
    ["a fenced code block", "```md\n- [ ] Ship direct sync\n```"],
  ])(
    "revalidates the complete note and rejects a task moved into %s",
    (_label, content) => {
      expect(() =>
        applyIntentsToContent(content, [
          {
            notePath: "Tasks.md",
            lineNumber: 2,
            expectedLineHash:
              "cad90bd03e1ef132b9e0b0d3e61f80aba00a254fa4ba2778dd3ba18ecf19444a",
            newBlockId: "dainvo-44444444-4444-4444-8444-444444444444",
            previousNotePath: "Tasks.md",
            previousLineNumber: 2,
            replaceBlockId: null,
          },
        ]),
      ).toThrow("stable_id_unsupported_line");
    },
  );

  it("repairs copied Dainvo IDs in future-only mode and flags other duplicates", async () => {
    const fixture = createVaultFixture({
      "Tasks.md": [
        "- [ ] First ^dainvo-shared",
        "- [ ] Copied ^dainvo-shared",
        "- [ ] Legacy first ^legacy-shared",
        "- [ ] Legacy copied ^legacy-shared",
        "- [ ] Existing ID-less task",
      ].join("\n"),
    });
    const settings = structuredClone(DEFAULT_SETTINGS);
    let saves = 0;
    const coordinator = new StableIdCoordinator(
      fixture.vault,
      () => settings,
      async () => {
        saves += 1;
      },
    );

    const result = await coordinator.normalize({
      mode: "future_only",
      deviceId: "device-a",
    });

    expect(result).toMatchObject({
      changed: 1,
      duplicateCount: 1,
      baselineCreated: true,
    });
    expect(fixture.content("Tasks.md")).toMatch(
      /Copied \^dainvo-[0-9a-f-]{36}/,
    );
    expect(fixture.content("Tasks.md")).toContain(
      "Legacy copied ^legacy-shared",
    );
    expect(fixture.content("Tasks.md")).toContain(
      "Existing ID-less task",
    );
    expect(saves).toBeGreaterThan(0);
  });

  it("does not classify an unchanged task moved between notes as new", async () => {
    const fixture = createVaultFixture({
      "Inbox.md": "- [ ] Move me",
    });
    const settings = structuredClone(DEFAULT_SETTINGS);
    const coordinator = new StableIdCoordinator(
      fixture.vault,
      () => settings,
      async () => undefined,
    );

    await coordinator.normalize({ mode: "future_only", deviceId: "device-a" });
    fixture.replace({ "Projects/Moved.md": "- [ ] Move me" });
    const result = await coordinator.normalize({
      mode: "future_only",
      deviceId: "device-a",
    });

    expect(result.changed).toBe(0);
    expect(fixture.content("Projects/Moved.md")).toBe("- [ ] Move me");
  });
});

function createVaultFixture(initial: Record<string, string>) {
  let contents = new Map(Object.entries(initial));
  const files = () =>
    [...contents.keys()].sort().map((path) => ({ path, extension: "md" }));
  const vault = {
    getMarkdownFiles: files,
    cachedRead: async (file: { path: string }) => contents.get(file.path) ?? "",
    getAbstractFileByPath: (path: string) =>
      files().find((file) => file.path === path) ?? null,
    process: async (
      file: { path: string },
      transform: (content: string) => string,
    ) => {
      contents.set(file.path, transform(contents.get(file.path) ?? ""));
    },
  } as never;

  return {
    vault,
    content: (path: string) => contents.get(path) ?? "",
    replace: (next: Record<string, string>) => {
      contents = new Map(Object.entries(next));
    },
  };
}
