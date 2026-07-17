import { describe, expect, it } from "vitest";

import { buildOpenUri, parseMarkdownTasks } from "../src/parser";

describe("parseMarkdownTasks", () => {
  it("parses Markdown and Tasks-compatible metadata", () => {
    const tasks = parseMarkdownTasks({
      vaultId: "vault-a",
      vaultName: "Work Vault",
      notePath: "Projects/Plan.md",
      content: [
        "# Launch",
        "",
        "- [ ] Ship task #ops 📅 2026-06-10 🔺 ^ship-task",
        "- [x] Done task ✅ 2026-06-01 #done",
        "- [x] Done without metadata ^plain-done",
      ].join("\n"),
    });

    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      providerTaskId: "vault-a:block:ship-task",
      title: "Ship task",
      status: "open",
      priority: 1,
      labels: ["ops"],
      dueAt: "2026-06-10T00:00:00.000Z",
      completedAt: null,
      notePath: "Projects/Plan.md",
      noteTitle: "Plan",
      heading: "Launch",
      lineNumber: 3,
      blockId: "ship-task",
      parserFormat: "tasks",
    });
    expect(tasks[0]?.openUri).toContain("obsidian://open");
    expect(tasks[0]?.openUri).toContain(
      "file=Projects%2FPlan.md%23%5Eship-task",
    );
    expect(tasks[0]?.openUri).not.toContain("block=");

    expect(tasks[1]).toMatchObject({
      title: "Done task",
      status: "completed",
      labels: ["done"],
      completedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(tasks[2]).toMatchObject({
      title: "Done without metadata",
      status: "completed",
      completedAt: null,
    });
  });

  it("parses Dataview inline due dates and plain Markdown tasks", () => {
    const tasks = parseMarkdownTasks({
      vaultId: "vault-b",
      vaultName: "Personal",
      notePath: "Inbox.md",
      content: [
        "- [ ] Call vendor [due:: 2026-07-04] #phone",
        "- [ ] Plain checkbox",
      ].join("\n"),
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      title: "Call vendor",
      dueAt: "2026-07-04T00:00:00.000Z",
      labels: ["phone"],
      parserFormat: "tasks",
    });
    expect(tasks[1]).toMatchObject({
      title: "Plain checkbox",
      dueAt: null,
      labels: [],
      parserFormat: "markdown",
    });
  });

  it("does not include unsupported Tasks metadata in imported titles", () => {
    const tasks = parseMarkdownTasks({
      vaultId: "vault-c",
      vaultName: "Research",
      notePath: "Research.md",
      content:
        "- [ ] Review plan ⏳ 2026-06-09 🛫 2026-06-08 ➕ 2026-06-01 [context:: launch] 🔽 #next ^meta",
    });

    expect(tasks[0]).toMatchObject({
      title: "Review plan",
      priority: 4,
      labels: ["next"],
      blockId: "meta",
    });
  });

  it("excludes blank and metadata-only tasks", () => {
    const tasks = parseMarkdownTasks({
      vaultId: "vault-blank",
      vaultName: "Personal",
      notePath: "Inbox.md",
      content: [
        "- [ ]",
        "- [ ] ",
        "- [x]    ",
        "- [ ] #inbox",
        "- [ ] 📅 2026-07-16",
        "- [x] ✅ 2026-07-15",
        "- [ ] 🔺 ^priority-only",
        "- [ ] 🔁 every day ⏳ 2026-07-16 [context:: home] 🔽",
        "- [ ] 2026-07-16 is visible task text",
        "- [ ] Keep this title #inbox 📅 2026-07-16 ^keep",
      ].join("\n"),
    });

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.title)).toEqual([
      "2026-07-16 is visible task text",
      "Keep this title",
    ]);
  });

  it("percent-encodes spaces in Obsidian open URIs", () => {
    const openUri = buildOpenUri(
      "Work Vault",
      "Daily Notes/2026-06-07.md",
      "dainvo-test",
    );

    expect(openUri).toBe(
      "obsidian://open?vault=Work%20Vault&file=Daily%20Notes%2F2026-06-07.md%23%5Edainvo-test",
    );
    expect(openUri).not.toContain("+");
  });
});
