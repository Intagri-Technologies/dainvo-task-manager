import type { DainvoPluginSettings, PendingOperation, WriteBackReceipt } from "./types";
import { DainvoWriteBackConflict } from "./writeBack";

/** Save before write and before ACK. An ACK failure must never redo a note edit. */
export async function processJournaledBridgeOperation(input: {
  operation: PendingOperation;
  journal: DainvoPluginSettings["bridgeOperationJournal"];
  save(): Promise<void>;
  requireReceipt?: boolean;
  apply(operation: PendingOperation, recoveringPrepared: boolean): Promise<void | WriteBackReceipt>;
  acknowledge(id: string, result: { status: "succeeded" | "conflict" | "failed"; error?: string; receipt?: WriteBackReceipt }): Promise<void>;
}): Promise<void> {
  const recoveringPrepared = input.journal[input.operation.id]?.state === "prepared";
  const entry = input.journal[input.operation.id] ?? {
    operation: input.operation, state: "prepared" as const,
  };
  input.journal[input.operation.id] = entry;
  await input.save();
  if (entry.state !== "written" || (input.requireReceipt && !entry.receipt)) {
    try {
      const receipt = await input.apply(entry.operation, recoveringPrepared || entry.state === "written");
      if (receipt) entry.receipt = receipt;
    } catch (error) {
      // A failed write leaves no entry behind (a cross-note move keeps its
      // saved block for the retry). Left as "prepared", the desktop's retry
      // would be read as an uncertain earlier write and refused every time.
      if (!entry.move) {
        delete input.journal[input.operation.id];
        await input.save();
      }
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
  await input.acknowledge(input.operation.id, { status: "succeeded", ...(entry.receipt ? { receipt: entry.receipt } : {}) });
  delete input.journal[input.operation.id];
  await input.save();
}
