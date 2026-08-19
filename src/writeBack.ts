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
  if (
    operation.operationType === "move" &&
    operation.hierarchyMove?.target &&
    operation.hierarchyMove.target.notePath !== operation.source.notePath
  ) {
    await applyCrossNoteHierarchyMoveToVault(vault, operation);
    return;
  }
  const file = vault.getAbstractFileByPath(operation.source.notePath);

  if (!file || !isTFile(file)) {
    throw new DainvoWriteBackConflict("Source note is missing.");
  }

  await vault.process(file, (content) =>
    applyOperationToContent(content, operation),
  );
}

async function applyCrossNoteHierarchyMoveToVault(
  vault: Vault,
  operation: PendingOperation,
): Promise<void> {
  const target = operation.hierarchyMove?.target;
  if (!target || !operation.source.blockId || !target.blockId) {
    throw new DainvoWriteBackConflict(
      "Stable task markers are required for a cross-note move.",
    );
  }
  const sourceFile = vault.getAbstractFileByPath(operation.source.notePath);
  const targetFile = vault.getAbstractFileByPath(target.notePath);
  if (!targetFile || !isTFile(targetFile)) {
    throw new DainvoWriteBackConflict("Parent note is missing.");
  }

  if (!sourceFile || !isTFile(sourceFile)) {
    throw new DainvoWriteBackConflict("Source note is missing.");
  }

  const sourceContent = await vault.cachedRead(sourceFile);
  const sourceDocument = splitDocument(sourceContent);
  const sourceIndex = findSourceLineIndex(
    sourceDocument.lines,
    operation.source,
  );
  const sourceBlock =
    sourceIndex === -1
      ? null
      : extractTaskBlock(sourceDocument.lines, sourceIndex);
  let insertedLines: string[] | null = null;
  let inserted = false;
  let destinationContainsSource = false;

  await vault.process(targetFile, (content) => {
    const document = splitDocument(content);
    const targetIndex = findSourceLineIndex(document.lines, target);
    if (targetIndex === -1) {
      throw new DainvoWriteBackConflict(
        "Parent task changed before write-back.",
      );
    }
    const existingDestinationIndex = findBlockIdLineInLines(
      document.lines,
      operation.source.blockId!,
    );
    if (existingDestinationIndex !== -1) {
      assertExistingDestinationBlock({
        lines: document.lines,
        targetIndex,
        sourceIndex: existingDestinationIndex,
        sourceBlockLines: sourceBlock?.lines ?? null,
        sourceRawTaskLine: operation.source.rawTaskLine,
      });
      destinationContainsSource = true;
      return content;
    }
    if (!sourceBlock) {
      throw new DainvoWriteBackConflict(
        "Task source changed before write-back.",
      );
    }
    const targetLine = document.lines[targetIndex] ?? "";
    const targetIndent = leadingWhitespace(targetLine);
    const targetColumns = countIndentColumns(targetLine);
    let insertIndex = findTaskSubtreeEnd(
      document.lines,
      targetIndex,
      targetColumns,
    );
    while (insertIndex > targetIndex + 1 && !document.lines[insertIndex - 1]?.trim())
      insertIndex -= 1;
    const indentUnit = findChildIndentUnit(
      document.lines,
      targetIndex,
      insertIndex,
      targetIndent,
      targetColumns,
    );
    insertedLines = rebaseTaskBlock(
      sourceBlock.lines,
      `${targetIndent}${indentUnit}`,
    );
    document.lines.splice(insertIndex, 0, ...insertedLines);
    inserted = true;
    return joinLines(document.lines, document.eol, document.hadFinalNewline);
  });

  if (!sourceBlock && destinationContainsSource) return;

  try {
    await vault.process(sourceFile, (content) => {
      if (content !== sourceContent) {
        throw new DainvoWriteBackConflict(
          "Source note changed before deletion.",
        );
      }
      const document = splitDocument(content);
      const currentIndex = findSourceLineIndex(document.lines, operation.source);
      if (currentIndex === -1) {
        throw new DainvoWriteBackConflict(
          "Task source changed before deletion.",
        );
      }
      const currentBlock = extractTaskBlock(document.lines, currentIndex);
      document.lines.splice(
        currentBlock.start,
        currentBlock.end - currentBlock.start,
      );
      return joinLines(document.lines, document.eol, document.hadFinalNewline);
    });
  } catch (error) {
    if (inserted && insertedLines) {
      try {
        await vault.process(targetFile, (content) =>
          removeExactInsertedBlock(
            content,
            operation.source.blockId!,
            insertedLines!,
          ),
        );
      } catch {
        throw new Error(
          "Source deletion failed and the destination copy could not be safely removed; the move will be retried.",
        );
      }
    }
    throw error;
  }
}

function assertExistingDestinationBlock(input: {
  lines: readonly string[];
  targetIndex: number;
  sourceIndex: number;
  sourceBlockLines: readonly string[] | null;
  sourceRawTaskLine: string;
}): void {
  const targetColumns = countIndentColumns(input.lines[input.targetIndex] ?? "");
  const sourceColumns = countIndentColumns(input.lines[input.sourceIndex] ?? "");
  if (
    input.sourceIndex <= input.targetIndex ||
    sourceColumns <= targetColumns ||
    !hasDirectTaskAncestor(
      input.lines,
      input.targetIndex,
      input.sourceIndex,
      sourceColumns,
      targetColumns,
    )
  ) {
    throw new DainvoWriteBackConflict(
      "The existing destination task is not a child of the requested parent.",
    );
  }

  const destinationBlock = extractTaskBlock(input.lines, input.sourceIndex);
  if (input.sourceBlockLines) {
    const expected = rebaseTaskBlock(input.sourceBlockLines, "");
    const actual = rebaseTaskBlock(destinationBlock.lines, "");
    if (
      expected.length !== actual.length ||
      expected.some((line, index) => line !== actual[index])
    ) {
      throw new DainvoWriteBackConflict(
        "The existing destination task block does not match.",
      );
    }
    return;
  }

  if (
    (destinationBlock.lines[0] ?? "").trimStart() !==
    input.sourceRawTaskLine.trimStart()
  ) {
    throw new DainvoWriteBackConflict(
      "The existing destination task line does not match.",
    );
  }
}

function hasDirectTaskAncestor(
  lines: readonly string[],
  targetIndex: number,
  sourceIndex: number,
  sourceColumns: number,
  targetColumns: number,
): boolean {
  for (let index = sourceIndex - 1; index >= targetIndex; index -= 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    const columns = countIndentColumns(line);
    if (TASK_LINE_RE.test(line) && columns < sourceColumns) {
      return index === targetIndex;
    }
    if (columns <= targetColumns) return false;
  }
  return false;
}

function removeExactInsertedBlock(
  content: string,
  blockId: string,
  expectedLines: readonly string[],
): string {
  const document = splitDocument(content);
  const index = findBlockIdLineInLines(document.lines, blockId);
  if (
    index === -1 ||
    expectedLines.some((line, offset) => document.lines[index + offset] !== line)
  ) {
    throw new Error("The inserted destination block changed.");
  }
  document.lines.splice(index, expectedLines.length);
  return joinLines(document.lines, document.eol, document.hadFinalNewline);
}

function splitDocument(content: string): {
  lines: string[];
  eol: string;
  hadFinalNewline: boolean;
} {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(content);
  const lines = content.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  return { lines, eol, hadFinalNewline };
}

function findBlockIdLineInLines(
  lines: readonly string[],
  blockId: string,
): number {
  const pattern = new RegExp(`(?:^|\\s)\\^${escapeRegExp(blockId)}\\s*$`);
  return lines.findIndex((line) => pattern.test(line));
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

const TASK_LINE_RE = /^\s*[-*+]\s+\[[ xX]\](?:\s+|$)/;

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
  const sourceBlock = extractTaskBlock(lines, sourceIndex);

  if (!move.target) {
    lines.splice(
      sourceBlock.start,
      sourceBlock.end - sourceBlock.start,
      ...rebaseTaskBlock(sourceBlock.lines, ""),
    );
    return joinLines(lines, eol, hadFinalNewline);
  }
  if (move.target.notePath !== operation.source.notePath)
    throw new DainvoWriteBackConflict("Use the cross-note vault writer.");

  const withoutSource = [
    ...lines.slice(0, sourceBlock.start),
    ...lines.slice(sourceBlock.end),
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
  withoutSource.splice(insertIndex, 0, ...rebaseTaskBlock(
    sourceBlock.lines,
    `${targetIndent}${indentUnit}`,
  ));
  return joinLines(withoutSource, eol, hadFinalNewline);
}

type TaskBlock = { start: number; end: number; lines: string[] };

function extractTaskBlock(
  lines: readonly string[],
  sourceIndex: number,
): TaskBlock {
  const sourceColumns = countIndentColumns(lines[sourceIndex] ?? "");
  let end = sourceIndex + 1;
  for (let index = sourceIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      end = index + 1;
      continue;
    }
    const columns = countIndentColumns(line);
    if (!TASK_LINE_RE.test(line)) {
      if (columns <= sourceColumns) break;
      end = index + 1;
      continue;
    }
    if (columns <= sourceColumns) break;
    throw new DainvoWriteBackConflict(
      "Obsidian tasks with subtasks cannot be moved yet.",
    );
  }
  while (end > sourceIndex + 1 && !lines[end - 1]?.trim()) end -= 1;
  return { start: sourceIndex, end, lines: lines.slice(sourceIndex, end) };
}

function rebaseTaskBlock(lines: readonly string[], nextIndent: string): string[] {
  const sourceIndent = leadingWhitespace(lines[0] ?? "");
  return lines.map((line) => {
    if (!line.trim()) return line;
    const relative = line.startsWith(sourceIndent)
      ? line.slice(sourceIndent.length)
      : line.replace(/^\s*/, "");
    return `${nextIndent}${relative}`;
  });
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
