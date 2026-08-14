import type { TFile, Vault } from "obsidian";

import { hashTaskLine, patchMarkdownTaskLine } from "./taskLine";
import type { PendingMutationOperation, PendingOperation } from "./types";

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
  if (operation.operationType === "move") {
    if (!operation.hierarchyMove) {
      throw new DainvoWriteBackConflict(
        "The Obsidian hierarchy destination is missing.",
      );
    }
    try {
      return applyHierarchyMoveToContent(content, operation);
    } catch (error) {
      if (error instanceof DainvoWriteBackConflict) throw error;
      throw new DainvoWriteBackConflict(formatError(error));
    }
  }
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

const TASK_LINE_RE = /^\s*[-*+]\s+\[[ xX]\]\s+/;

function applyHierarchyMoveToContent(
  content: string,
  operation: PendingMutationOperation,
): string {
  const move = operation.hierarchyMove!;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(content);
  const lines = content.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();

  const sourceIndex = findSourceLineIndex(lines, operation.source);
  if (sourceIndex === -1) {
    throw new DainvoWriteBackConflict(
      "Task source changed before write-back.",
    );
  }
  assertLeafTask(lines, sourceIndex);
  const sourceLine = lines[sourceIndex] ?? "";

  if (!move.target) {
    lines[sourceIndex] = sourceLine.replace(/^\s*/, "");
    return joinLines(lines, eol, hadFinalNewline);
  }
  if (move.target.notePath !== operation.source.notePath) {
    throw new DainvoWriteBackConflict(
      "Obsidian hierarchy moves must stay in one note.",
    );
  }

  const withoutSource = [
    ...lines.slice(0, sourceIndex),
    ...lines.slice(sourceIndex + 1),
  ];
  const targetIndex = findSourceLineIndex(withoutSource, move.target);
  if (targetIndex === -1) {
    throw new DainvoWriteBackConflict(
      "Parent task changed before write-back.",
    );
  }
  const targetLine = withoutSource[targetIndex] ?? "";
  const targetIndent = leadingWhitespace(targetLine);
  const targetColumns = countIndentColumns(targetLine);
  let insertIndex = findTaskSubtreeEnd(
    withoutSource,
    targetIndex,
    targetColumns,
  );
  while (
    insertIndex > targetIndex + 1 &&
    !withoutSource[insertIndex - 1]?.trim()
  ) {
    insertIndex -= 1;
  }
  const indentUnit = findChildIndentUnit(
    withoutSource,
    targetIndex,
    insertIndex,
    targetIndent,
    targetColumns,
  );
  withoutSource.splice(
    insertIndex,
    0,
    sourceLine.replace(/^\s*/, `${targetIndent}${indentUnit}`),
  );
  return joinLines(withoutSource, eol, hadFinalNewline);
}

function assertLeafTask(lines: readonly string[], sourceIndex: number): void {
  const sourceColumns = countIndentColumns(lines[sourceIndex] ?? "");
  for (let index = sourceIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    if (!TASK_LINE_RE.test(line)) {
      if (countIndentColumns(line) <= sourceColumns) return;
      continue;
    }
    const columns = countIndentColumns(line);
    if (columns <= sourceColumns) return;
    throw new DainvoWriteBackConflict(
      "Obsidian tasks with subtasks cannot be moved yet.",
    );
  }
}

function findTaskSubtreeEnd(
  lines: readonly string[],
  targetIndex: number,
  targetColumns: number,
): number {
  for (let index = targetIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    const columns = countIndentColumns(line);
    if (TASK_LINE_RE.test(line)) {
      if (columns <= targetColumns) return index;
      continue;
    }
    if (columns <= targetColumns) return index;
  }
  return lines.length;
}

function findChildIndentUnit(
  lines: readonly string[],
  targetIndex: number,
  subtreeEnd: number,
  targetIndent: string,
  targetColumns: number,
): string {
  for (let index = targetIndex + 1; index < subtreeEnd; index += 1) {
    const line = lines[index] ?? "";
    if (!TASK_LINE_RE.test(line) || countIndentColumns(line) <= targetColumns) {
      continue;
    }
    const whitespace = leadingWhitespace(line);
    if (whitespace.startsWith(targetIndent)) {
      const unit = whitespace.slice(targetIndent.length);
      if (unit) return unit;
    }
  }
  return "\t";
}

function leadingWhitespace(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? "";
}

function countIndentColumns(line: string): number {
  let columns = 0;
  for (const character of leadingWhitespace(line)) {
    columns =
      character === "\t" ? columns + (4 - (columns % 4)) : columns + 1;
  }
  return columns;
}

function joinLines(
  lines: readonly string[],
  eol: string,
  hadFinalNewline: boolean,
): string {
  return lines.join(eol) + (hadFinalNewline && lines.length ? eol : "");
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
