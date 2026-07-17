import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  normalizePath: (value: string) => value.replace(/\\/g, "/"),
  requestUrl: vi.fn(),
}));

let classifyPendingOperation: typeof import("../src/cloudSync").classifyPendingOperation;
let selectRelayTasks: typeof import("../src/cloudSync").selectRelayTasks;

beforeAll(async () => {
  ({ classifyPendingOperation, selectRelayTasks } = await import(
    "../src/cloudSync"
  ));
});

const operation = {
  id: "cloud-operation",
  operation_id: "mobile-operation",
  operation_type: "complete" as const,
  task_id: "cloud-task",
  provider_task_id: "vault:block:dainvo-task",
  local_vault_id: "vault",
  base_server_version: 4,
  current_task_status: "open" as const,
  current_task_server_version: 4,
};

describe("cloud pending-operation conflict handling", () => {
  it("treats an already matching local status as applied", () => {
    expect(
      classifyPendingOperation(operation, "completed", "completed"),
    ).toBe("already_applied");
  });

  it("rejects stale and missing base versions when status differs", () => {
    expect(
      classifyPendingOperation(
        { ...operation, base_server_version: 3 },
        "open",
        "completed",
      ),
    ).toBe("stale_server_version");
    expect(
      classifyPendingOperation(
        { ...operation, base_server_version: null },
        "open",
        "completed",
      ),
    ).toBe("stale_server_version");
  });

  it("conflicts when Markdown changed locally after the server projection", () => {
    expect(
      classifyPendingOperation(operation, "completed", "open"),
    ).toBe("local_status_changed");
  });

  it("allows a write only when server and local state still agree", () => {
    expect(classifyPendingOperation(operation, "open", "completed")).toBe(
      "write",
    );
  });

  it("allows delete only for the current projected version and status", () => {
    const deletion = { ...operation, operation_type: "delete" as const };
    expect(classifyPendingOperation(deletion, "open", null)).toBe("write");
    expect(
      classifyPendingOperation(
        { ...deletion, current_task_server_version: 5 },
        "open",
        null,
      ),
    ).toBe("stale_server_version");
    expect(classifyPendingOperation(deletion, "completed", null)).toBe(
      "local_status_changed",
    );
  });
});

describe("relay task window selection", () => {
  it("preserves the first duplicate owner and applies independent task windows", () => {
    const tasks = [
      relayTask("duplicate", "Z.md", "open"),
      relayTask("duplicate", "A.md", "completed"),
      ...Array.from({ length: 301 }, (_, index) =>
        relayTask(`active-${index}`, `Active/${index}.md`, "open"),
      ),
      ...Array.from({ length: 701 }, (_, index) =>
        relayTask(`completed-${index}`, `Completed/${index}.md`, "completed"),
      ),
    ];

    const selected = selectRelayTasks(tasks);

    expect(selected.filter((task) => task.status === "open")).toHaveLength(300);
    expect(selected.filter((task) => task.status === "completed")).toHaveLength(
      700,
    );
    expect(
      selected.filter((task) => task.providerTaskId === "duplicate"),
    ).toEqual([expect.objectContaining({ notePath: "A.md" })]);
  });
});

function relayTask(
  providerTaskId: string,
  notePath: string,
  status: "open" | "completed",
) {
  return {
    providerTaskId,
    title: providerTaskId,
    status,
    priority: 4,
    labels: [],
    dueAt: null,
    completedAt:
      status === "completed" ? "2026-07-17T00:00:00.000Z" : null,
    notePath,
    noteTitle: notePath,
    heading: null,
    lineNumber: 1,
    blockId: providerTaskId,
    lineHash: providerTaskId,
    rawTaskLine: `- [${status === "completed" ? "x" : " "}] ${providerTaskId}`,
    openUri: "obsidian://open",
    parserFormat: "markdown" as const,
  };
}
