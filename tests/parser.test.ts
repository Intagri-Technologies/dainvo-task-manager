import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildOpenUri, parseMarkdownTasks } from "../src/parser";

describe("parseMarkdownTasks", () => {
  it("matches the shared desktop/plugin schema-v2 hierarchy fixture", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/obsidian_hierarchy_v2.json", import.meta.url),
        "utf8",
      ),
    ) as {
      vaultId: string;
      vaultName: string;
      notePath: string;
      content: string;
      expected: Array<Record<string, unknown>>;
    };
    const tasks = parseMarkdownTasks(fixture);

    expect(tasks.map((task) => ({
      providerTaskId: task.providerTaskId,
      parentProviderTaskId: task.parentProviderTaskId,
      indentColumns: task.indentColumns,
      siblingOrder: task.siblingOrder,
    }))).toEqual(fixture.expected);
  });

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

  it("retains blank and metadata-only tasks for hierarchy snapshots", () => {
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

    expect(tasks).toHaveLength(10);
    expect(tasks.slice(0, 8).every((task) => task.isBlank)).toBe(true);
    expect(tasks.slice(8).map((task) => task.title)).toEqual([
      "2026-07-16 is visible task text",
      "Keep this title",
    ]);
  });

  it("ignores frontmatter and fenced-code task examples", () => {
    const tasks = parseMarkdownTasks({
      vaultId: "vault-safe",
      vaultName: "Safe",
      notePath: "Examples.md",
      content: [
        "---",
        "example: '- [ ] Not a real task'",
        "---",
        "# Real work",
        "```markdown",
        "- [ ] Example inside code",
        "```",
        "~~~",
        "- [x] Another example",
        "~~~",
        "> - [ ] Quoted example",
        "- [ ] Actual task",
      ].join("\n"),
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "Actual task",
      heading: "Real work",
      lineNumber: 12,
    });
  });

  it("projects Markdown indentation as stable schema-v2 hierarchy", () => {
    const tasks = parseMarkdownTasks({
      vaultId: "vault-tree",
      vaultName: "Projects",
      notePath: "Tree.md",
      content: [
        "- [ ] Parent ^parent",
        "  - [ ] First child ^first",
        "    - [ ] Grandchild ^grandchild",
        "  - [x] Second child ^second",
        "- [ ] Other root ^other",
        "\t- [ ] Tab child ^tab-child",
      ].join("\n"),
    });

    expect(tasks.map((task) => ({
      id: task.providerTaskId,
      parent: task.parentProviderTaskId,
      indent: task.indentColumns,
      order: task.siblingOrder,
    }))).toEqual([
      { id: "vault-tree:block:parent", parent: null, indent: 0, order: 0 },
      {
        id: "vault-tree:block:first",
        parent: "vault-tree:block:parent",
        indent: 2,
        order: 0,
      },
      {
        id: "vault-tree:block:grandchild",
        parent: "vault-tree:block:first",
        indent: 4,
        order: 0,
      },
      {
        id: "vault-tree:block:second",
        parent: "vault-tree:block:parent",
        indent: 2,
        order: 1,
      },
      { id: "vault-tree:block:other", parent: null, indent: 0, order: 1 },
      {
        id: "vault-tree:block:tab-child",
        parent: "vault-tree:block:other",
        indent: 4,
        order: 0,
      },
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
