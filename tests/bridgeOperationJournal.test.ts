import { describe, expect, it, vi } from "vitest";
import { processJournaledBridgeOperation } from "../src/bridgeOperationJournal";
import { parseMarkdownTasks } from "../src/parser";
import type { DainvoPluginSettings, PendingOperation } from "../src/types";

function operation(): PendingOperation {
  const source = parseMarkdownTasks({ vaultId: "vault", vaultName: "Vault", notePath: "Tasks.md", content: "- [ ] Original ^task" })[0];
  return { id: "operation", operationType: "update", source,
    task: { id: "task", title: "Edited", status: "open", priority: 0, labels: [], dueAt: null } };
}

describe("local bridge operation journal", () => {
  it("does not repeat a write after a lost acknowledgement and plugin restart", async () => {
    let stored = "{}";
    let journal: DainvoPluginSettings["bridgeOperationJournal"] = {};
    const save = async () => { stored = JSON.stringify(journal); };
    const apply = vi.fn(async () => undefined);
    const acknowledge = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("ACK response lost"));
    await expect(processJournaledBridgeOperation({ operation: operation(), journal, save, apply, acknowledge })).rejects.toThrow("ACK response lost");
    expect(apply).toHaveBeenCalledOnce();
    journal = JSON.parse(stored) as typeof journal;
    expect(journal.operation?.state).toBe("written");
    await processJournaledBridgeOperation({ operation: operation(), journal, save, apply, acknowledge });
    expect(apply).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenLastCalledWith("operation", { status: "succeeded" });
    expect(JSON.parse(stored)).toEqual({});
  });

  it("does not write or acknowledge when the durable intent cannot be saved", async () => {
    const apply = vi.fn(async () => undefined);
    const acknowledge = vi.fn(async () => undefined);
    await expect(processJournaledBridgeOperation({ operation: operation(), journal: {}, save: async () => { throw new Error("disk full"); }, apply, acknowledge })).rejects.toThrow("disk full");
    expect(apply).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("marks recovery after a crash between the write and the durable receipt", async () => {
    let stored = "{}";
    let journal: DainvoPluginSettings["bridgeOperationJournal"] = {};
    let saveCount = 0;
    const apply = vi.fn(async () => undefined);
    const acknowledge = vi.fn(async () => undefined);
    await expect(processJournaledBridgeOperation({ operation: operation(), journal, apply, acknowledge, save: async () => {
      saveCount += 1;
      if (saveCount === 2) throw new Error("receipt save failed");
      stored = JSON.stringify(journal);
    } })).rejects.toThrow("receipt save failed");
    expect(acknowledge).not.toHaveBeenCalled();
    expect(apply).toHaveBeenLastCalledWith(operation(), false);
    journal = JSON.parse(stored) as typeof journal;
    await processJournaledBridgeOperation({ operation: operation(), journal, apply, acknowledge, save: async () => { stored = JSON.stringify(journal); } });
    expect(apply).toHaveBeenLastCalledWith(operation(), true);
  });
});
