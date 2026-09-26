import { describe, expect, it, vi } from "vitest";
import { parseMarkdownTasks } from "../src/parser";
import { applyOperationToVault } from "../src/writeBack";
import { processJournaledBridgeOperation } from "../src/bridgeOperationJournal";
import type { CrossNoteMoveJournal, DainvoPluginSettings, PendingOperation } from "../src/types";

function fixture() {
  const identity = { vaultId: "vault", vaultName: "Vault" };
  const source = "- [ ] Task ^source\n  detail\n";
  const target = "- [ ] Parent ^parent\n";
  const parsed = parseMarkdownTasks({ ...identity, notePath: "Source.md", content: source })[0];
  const parent = parseMarkdownTasks({ ...identity, notePath: "Target.md", content: target })[0];
  const operation: PendingOperation = { id: "move", operationType: "move", source: parsed, task: { id: "task", title: "Task", status: "open", priority: 0, labels: [], dueAt: null }, hierarchyMove: { parentTaskId: "parent", parentProviderTaskId: parent.providerTaskId, target: parent } };
  const files = new Map([["Source.md", source], ["Target.md", target]]);
  let fail: "source-before" | "source-after" | null = null;
  const vault = {
    getAbstractFileByPath: (path: string) => files.has(path) ? { path, extension: "md" } : null,
    cachedRead: async (file: { path: string }) => files.get(file.path)!,
    process: async (file: { path: string }, update: (content: string) => string) => {
      if (file.path === "Source.md" && fail === "source-before") throw new Error("crash");
      const content = update(files.get(file.path)!); files.set(file.path, content);
      if (file.path === "Source.md" && fail === "source-after") throw new Error("crash");
      return content;
    },
  } as unknown as import("obsidian").Vault;
  return { identity, files, operation, vault, failAt: (value: typeof fail) => { fail = value; } };
}
describe("written anchors and cross-note crash recovery", () => {
  it.each(["source-before", "source-after"] as const)("resumes %s without inserting twice", async (stage) => {
    const f = fixture(); let saved: string | null = null;
    const saveMoveJournal = async (journal: CrossNoteMoveJournal) => { saved = JSON.stringify(journal); };
    f.failAt(stage);
    await expect(applyOperationToVault(f.vault, f.operation, { vaultIdentity: f.identity, saveMoveJournal })).rejects.toThrow("crash");
    f.failAt(null);
    const receipt = await applyOperationToVault(f.vault, f.operation, { vaultIdentity: f.identity, moveJournal: JSON.parse(saved!) as CrossNoteMoveJournal, saveMoveJournal });
    expect(f.files.get("Source.md")).toBe("");
    expect(f.files.get("Target.md")?.match(/\^source/g)).toHaveLength(1);
    expect(receipt?.writtenSource).toMatchObject({ notePath: "Target.md", blockId: "source", parentProviderTaskId: "vault:block:parent" });
  });
  it("keeps an external source task edit after insertion and refuses to remove it", async () => {
    const f = fixture(); let saved: string | null = null;
    const saveMoveJournal = async (journal: CrossNoteMoveJournal) => { saved = JSON.stringify(journal); };
    f.failAt("source-before");
    await expect(applyOperationToVault(f.vault, f.operation, { saveMoveJournal })).rejects.toThrow("crash");
    f.failAt(null); f.files.set("Source.md", "- [ ] External edit ^source\n  detail\n");
    await expect(applyOperationToVault(f.vault, f.operation, { moveJournal: JSON.parse(saved!) as CrossNoteMoveJournal, saveMoveJournal })).rejects.toThrow("source task changed");
    expect(f.files.get("Source.md")).toContain("External edit");
    expect(f.files.get("Target.md")?.match(/\^source/g)).toHaveLength(1);
  });
  it("sends the saved written anchor after a lost ACK without reading or writing again", async () => {
    const f = fixture(); let journal: DainvoPluginSettings["bridgeOperationJournal"] = {}; let saved = "{}";
    const save = async () => { saved = JSON.stringify(journal); };
    const apply = vi.fn(async (operation: PendingOperation) => applyOperationToVault(f.vault, operation, { vaultIdentity: f.identity, saveMoveJournal: async (move) => { journal[operation.id].move = move; await save(); } }));
    const acknowledge = vi.fn().mockRejectedValueOnce(new Error("ACK lost")).mockResolvedValue(undefined);
    await expect(processJournaledBridgeOperation({ operation: f.operation, journal, save, apply, acknowledge, requireReceipt: true })).rejects.toThrow("ACK lost");
    journal = JSON.parse(saved) as typeof journal;
    const receipt = journal.move.receipt;
    f.files.set("Target.md", "Externally changed");
    await processJournaledBridgeOperation({ operation: f.operation, journal, save, apply, acknowledge, requireReceipt: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenLastCalledWith("move", { status: "succeeded", receipt });
  });
});
