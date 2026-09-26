import type { TFile, Vault } from "obsidian";

import { parseMarkdownTasks } from "./parser";
import { hashTaskLine, patchMarkdownTaskLine } from "./taskLine";
import type { PendingMutationOperation, PendingOperation, CrossNoteMoveJournal, WriteBackReceipt } from "./types";

export class DainvoWriteBackConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DainvoWriteBackConflict";
  }
}

type WriteOptions = {
  recoveringPreparedCreate?: boolean;
  vaultIdentity?: { vaultId: string; vaultName: string };
  moveJournal?: CrossNoteMoveJournal;
  saveMoveJournal?(journal: CrossNoteMoveJournal): Promise<void>;
};
export async function applyOperationToVault(
  vault: Vault,
  operation: PendingOperation,
  options: WriteOptions = {},
): Promise<WriteBackReceipt | void> {
  let notePath = operation.source.notePath;
  let content: string;
  if (operation.operationType === "create") {
    content = await createTaskInVault(vault, operation, options.recoveringPreparedCreate ?? false);
  } else if (operation.operationType === "move" && operation.hierarchyMove?.target && operation.hierarchyMove.target.notePath !== operation.source.notePath) {
    notePath = operation.hierarchyMove.target.notePath;
    content = await applyCrossNoteHierarchyMoveToVault(vault, operation, options);
  } else {
    const file = vault.getAbstractFileByPath(notePath);
    if (!file || !isTFile(file)) throw new DainvoWriteBackConflict("Source note is missing.");
    content = await vault.process(file, (value) => {
      if (options.recoveringPreparedCreate && operation.source.blockId && ['update', 'complete', 'reopen'].includes(operation.operationType)) {
        const lines = splitDocument(value).lines;
        const matching = lines.filter((line) => new RegExp(`(?:^|\\s)\\^${escapeRegExp(operation.source.blockId!)}\\s*$`).test(line));
        const expected = patchSourceTaskLine(operation.source.rawTaskLine, operation);
        if (matching.length === 1 && matching[0] === expected) return value;
      }
      return applyOperationToContent(value, operation);
    });
  }
  if (!options.vaultIdentity) return;
  const candidates = operation.operationType === "delete" ? [] : parseMarkdownTasks({ ...options.vaultIdentity, notePath, content });
  const writtenSource = operation.operationType === "delete" ? null : candidates.find((task) => operation.source.blockId ? task.blockId === operation.source.blockId : task.lineNumber === operation.source.lineNumber);
  if (writtenSource === undefined) throw new DainvoWriteBackConflict("The written task anchor could not be verified.");
  return { previousSource: { notePath: operation.source.notePath, lineHash: operation.source.lineHash }, writtenSource };
}

async function createTaskInVault(vault: Vault, operation: PendingOperation, recoveringPrepared: boolean): Promise<string> {
  const intent = operation.create;
  if (!intent || intent.notePath !== operation.source.notePath || intent.blockId !== operation.source.blockId ||
    !/^[a-zA-Z0-9-]+$/.test(intent.blockId) || /[\r\n]/.test(intent.taskLine) ||
    !intent.taskLine.endsWith(`^${intent.blockId}`) ||
    intent.notePath.startsWith("/") || intent.notePath.includes("\\") || intent.notePath.split("/").some((part) => !part || part === "." || part === ".."))
    throw new DainvoWriteBackConflict("The task create identity is invalid.");
  const append = (content: string): string => {
    const lines = content.split(/\r?\n/);
    const matching = lines.filter((line) => new RegExp(`(?:^|\\s)\\^${escapeRegExp(intent.blockId)}\\s*$`).test(line));
    if (matching.length > 0) {
      if (matching.length === 1 && matching[0]?.trim() === intent.taskLine.trim()) return content;
      throw new DainvoWriteBackConflict("The created task marker already exists with different content.");
    }
    if (recoveringPrepared)
      throw new DainvoWriteBackConflict("The earlier create outcome is uncertain and its task marker is absent. Refresh the vault before resolving this create.");
    return appendTaskLineUnderHeading(content, intent.sectionHeading, intent.taskLine);
  };
  let file = vault.getAbstractFileByPath(intent.notePath);
  if (!file) {
    if (recoveringPrepared)
      throw new DainvoWriteBackConflict("The earlier create outcome is uncertain and its destination note is absent.");
    if (!intent.createNoteIfMissing) throw new DainvoWriteBackConflict("The task destination note was removed.");
    const parts = intent.notePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const folder = parts.slice(0, index).join("/");
      if (!vault.getAbstractFileByPath(folder)) {
        try { await vault.createFolder(folder); }
        catch (error) { if (!vault.getAbstractFileByPath(folder)) throw error; }
      }
    }
    try {
      const content = append(intent.initialContent ?? "");
      await vault.create(intent.notePath, content);
      return content;
    } catch (error) {
      // Another writer may have created the note. Never replace its contents.
      file = vault.getAbstractFileByPath(intent.notePath);
      if (!file) throw error;
    }
  }
  if (!isTFile(file)) throw new DainvoWriteBackConflict("The task destination is not a note.");
  return vault.process(file, append);
}

function appendTaskLineUnderHeading(content: string, sectionHeading: string, taskLine: string): string {
  const document = splitDocument(content);
  const heading = /^(#{1,6})\s+[^\r\n]+$/.test(sectionHeading.trim()) ? sectionHeading.trim() : "## Dainvo";
  const headingIndex = document.lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    while (document.lines.length && !document.lines.at(-1)?.trim()) document.lines.pop();
    if (document.lines.length) document.lines.push("");
    document.lines.push(heading, taskLine);
    return document.lines.join(document.eol) + document.eol;
  }
  const level = heading.match(/^#+/)![0].length;
  let insert = document.lines.length;
  for (let index = headingIndex + 1; index < document.lines.length; index += 1) {
    const match = document.lines[index]?.trim().match(/^(#{1,6})\s+.+/);
    if (match && match[1].length <= level) { insert = index; break; }
  }
  while (insert > headingIndex + 1 && !document.lines[insert - 1]?.trim()) insert -= 1;
  document.lines.splice(insert, 0, taskLine);
  return joinLines(document.lines, document.eol, document.hadFinalNewline);
}

async function applyCrossNoteHierarchyMoveToVault(
  vault: Vault,
  operation: PendingOperation,
  options: WriteOptions,
): Promise<string> {
  const target = operation.hierarchyMove?.target;
  const blockId = operation.source.blockId;
  if (!target || !blockId || !target.blockId) throw new DainvoWriteBackConflict("Stable task markers are required for a cross-note move.");
  const sourceFile = vault.getAbstractFileByPath(operation.source.notePath);
  const targetFile = vault.getAbstractFileByPath(target.notePath);
  if (!targetFile || !isTFile(targetFile)) throw new DainvoWriteBackConflict("Parent note is missing.");
  let journal = options.moveJournal;
  if (!journal) {
    if (!sourceFile || !isTFile(sourceFile)) throw new DainvoWriteBackConflict("Source note is missing.");
    const document = splitDocument(await vault.cachedRead(sourceFile));
    const index = findSourceLineIndex(document.lines, operation.source);
    if (index === -1) throw new DainvoWriteBackConflict("Task source changed before write-back.");
    journal = { sourceBlockLines: extractTaskBlock(document.lines, index).lines, destinationWritten: false };
    await options.saveMoveJournal?.(journal);
  }
  const saved = journal;
  const targetContent = await vault.process(targetFile, (content) => {
    const document = splitDocument(content);
    const targetIndex = findSourceLineIndex(document.lines, target);
    if (targetIndex === -1) throw new DainvoWriteBackConflict("Parent task changed before write-back.");
    const existing = findBlockIdLineInLines(document.lines, blockId);
    if (existing !== -1) {
      assertExistingDestinationBlock({ lines: document.lines, targetIndex, sourceIndex: existing, sourceBlockLines: saved.sourceBlockLines, sourceRawTaskLine: operation.source.rawTaskLine });
      return content;
    }
    if (saved.destinationWritten) throw new DainvoWriteBackConflict("The moved destination task was removed after it was written.");
    const targetLine = document.lines[targetIndex] ?? "";
    const targetIndent = leadingWhitespace(targetLine);
    const targetColumns = countIndentColumns(targetLine);
    let insertIndex = findTaskSubtreeEnd(document.lines, targetIndex, targetColumns);
    while (insertIndex > targetIndex + 1 && !document.lines[insertIndex - 1]?.trim()) insertIndex -= 1;
    const indent = findChildIndentUnit(document.lines, targetIndex, insertIndex, targetIndent, targetColumns);
    document.lines.splice(insertIndex, 0, ...rebaseTaskBlock(saved.sourceBlockLines, `${targetIndent}${indent}`));
    return joinLines(document.lines, document.eol, document.hadFinalNewline);
  });
  saved.destinationWritten = true;
  await options.saveMoveJournal?.(saved);
  if (sourceFile && isTFile(sourceFile)) {
    await vault.process(sourceFile, (content) => {
      const document = splitDocument(content);
      const index = findBlockIdLineInLines(document.lines, blockId);
      if (index === -1) return content; // Saved full block + verified destination proves this replay's identity.
      const block = extractTaskBlock(document.lines, index);
      if (block.lines.length !== saved.sourceBlockLines.length || block.lines.some((line, offset) => line !== saved.sourceBlockLines[offset]))
        throw new DainvoWriteBackConflict("The source task changed after the move was prepared. Review both notes before resolving this move.");
      document.lines.splice(block.start, block.end - block.start);
      return joinLines(document.lines, document.eol, document.hadFinalNewline);
    });
  }
  return targetContent;
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
  if (operation.operationType === "create") throw new DainvoWriteBackConflict("Use the vault task-create writer.");
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
