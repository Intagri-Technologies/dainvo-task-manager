import type { DainvoPluginSettings, PendingOperation } from "./types";
import { DainvoWriteBackConflict } from "./writeBack";

/** Save before write and before ACK. An ACK failure must never redo a note edit. */
export async function processJournaledBridgeOperation(input: {
  operation: PendingOperation;
  journal: DainvoPluginSettings["bridgeOperationJournal"];
  save(): Promise<void>;
  apply(operation: PendingOperation, recoveringPrepared: boolean): Promise<void>;
  acknowledge(id: string, result: { status: "succeeded" | "conflict" | "failed"; error?: string }): Promise<void>;
}): Promise<void> {
  const recoveringPrepared = input.journal[input.operation.id]?.state === "prepared";
  const entry = input.journal[input.operation.id] ?? {
    operation: input.operation, state: "prepared" as const,
  };
  input.journal[input.operation.id] = entry;
  await input.save();
  if (entry.state !== "written") {
    try {
      await input.apply(entry.operation, recoveringPrepared);
    } catch (error) {
      await input.acknowledge(input.operation.id, {
        status: error instanceof DainvoWriteBackConflict ? "conflict" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    entry.state = "written";
    await input.save();
  }
  // Keep network failures outside the write catch. The note has already changed.
  await input.acknowledge(input.operation.id, { status: "succeeded" });
  delete input.journal[input.operation.id];
  await input.save();
}
