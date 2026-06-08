import type { TFile, Vault } from "obsidian";

import { hashTaskLine, patchMarkdownTaskLine } from "./taskLine";
import type { PendingMutationOperation, PendingOperation } from "./types";

const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

export class DainvoWriteBackConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DainvoWriteBackConflict";
  }
}

export async function applyOperationToVault(
  vault: Vault,
  operation: PendingOperation,
): Promise<void> {
  const file = vault.getAbstractFileByPath(operation.source.notePath);

  if (!file || !isTFile(file)) {
    throw new DainvoWriteBackConflict("Source note is missing.");
  }

  await vault.process(file, (content) =>
    applyOperationToContent(content, operation),
  );
}

export function applyOperationToContent(
  content: string,
  operation: PendingMutationOperation,
): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(content);
  const lines = content.split(/\r?\n/);

  if (hadFinalNewline) {
    lines.pop();
  }

  const lineIndex = findSourceLineIndex(lines, operation.source);
  if (lineIndex === -1) {
    throw new DainvoWriteBackConflict("Task source changed before write-back.");
  }

  const patchedLine = patchSourceTaskLine(lines[lineIndex] ?? "", operation);
  const nextLines =
    patchedLine === null
      ? [...lines.slice(0, lineIndex), ...lines.slice(lineIndex + 1)]
      : [
          ...lines.slice(0, lineIndex),
          patchedLine,
          ...lines.slice(lineIndex + 1),
        ];

  return nextLines.join(eol) + (hadFinalNewline && nextLines.length ? eol : "");
}

function patchSourceTaskLine(
  existingLine: string,
  operation: PendingMutationOperation,
): string | null {
  try {
    return patchMarkdownTaskLine({ existingLine, operation });
  } catch (error) {
    throw new DainvoWriteBackConflict(formatError(error));
  }
}

function findSourceLineIndex(
  lines: readonly string[],
  source: {
    lineNumber: number;
    lineHash: string;
    blockId: string | null;
  },
): number {
  const expectedIndex = source.lineNumber - 1;

  if (
    expectedIndex >= 0 &&
    expectedIndex < lines.length &&
    hashTaskLine(lines[expectedIndex] ?? "") === source.lineHash
  ) {
    return expectedIndex;
  }

  if (source.blockId) {
    const blockPattern = new RegExp(
      `(?:^|\\s)\\^${escapeRegExp(source.blockId)}\\s*$`,
    );
    const blockIndex = lines.findIndex((line) => blockPattern.test(line));

    if (
      blockIndex !== -1 &&
      hashTaskLine(lines[blockIndex] ?? "") === source.lineHash
    ) {
      return blockIndex;
    }

    return -1;
  }

  return lines.findIndex((line) => hashTaskLine(line) === source.lineHash);
}

function isTFile(file: unknown): file is TFile {
  return Boolean(
    file && typeof file === "object" && "path" in file && "extension" in file,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
