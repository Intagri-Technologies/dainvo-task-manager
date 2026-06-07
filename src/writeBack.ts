import type { TFile, Vault } from 'obsidian';

import { hashTaskLine } from './parser';
import type { PendingOperation } from './types';

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const RECURRENCE_RE = /🔁\s+[^📅✅➕⏳🛫❌🔺⏫🔼🔽⏬#^]+/gu;
const UNSUPPORTED_TASKS_EMOJI_METADATA_RE =
  /(?:➕|⏳|🛫|❌)\s*\d{4}-\d{2}-\d{2}/gu;
const LOW_PRIORITY_METADATA_RE = /[🔽⏬]/gu;
const UNSUPPORTED_DATAVIEW_FIELD_RE =
  /\[(?!(?:due|completion|completed|done)::)[A-Za-z][A-Za-z0-9_-]*::\s*[^\]]+\]/gi;

export class DainvoWriteBackConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DainvoWriteBackConflict';
  }
}

export async function applyOperationToVault(
  vault: Vault,
  operation: PendingOperation
): Promise<void> {
  const file = vault.getAbstractFileByPath(operation.source.notePath);

  if (!file || !isTFile(file)) {
    throw new DainvoWriteBackConflict('Source note is missing.');
  }

  await vault.process(file, (content) =>
    applyOperationToContent(content, operation)
  );
}

export function applyOperationToContent(
  content: string,
  operation: PendingOperation
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(content);
  const lines = content.split(/\r?\n/);

  if (hadFinalNewline) {
    lines.pop();
  }

  const lineIndex = findSourceLineIndex(lines, operation.source);
  if (lineIndex === -1) {
    throw new DainvoWriteBackConflict('Task source changed before write-back.');
  }

  const patchedLine = patchMarkdownTaskLine({
    existingLine: lines[lineIndex] ?? '',
    operation
  });
  const nextLines =
    patchedLine === null
      ? [...lines.slice(0, lineIndex), ...lines.slice(lineIndex + 1)]
      : [
          ...lines.slice(0, lineIndex),
          patchedLine,
          ...lines.slice(lineIndex + 1)
        ];

  return nextLines.join(eol) + (hadFinalNewline && nextLines.length ? eol : '');
}

export function patchMarkdownTaskLine(input: {
  existingLine: string;
  operation: PendingOperation;
}): string | null {
  if (input.operation.operationType === 'delete') {
    return null;
  }

  const match = TASK_LINE_RE.exec(input.existingLine);
  if (!match) {
    throw new DainvoWriteBackConflict('Source line is no longer a task.');
  }

  const body = match[4] ?? '';
  const blockId = extractBlockId(body);
  const preservedMetadata = extractPreservedMetadata(
    body,
    input.operation.task.priority
  );
  const checkbox =
    input.operation.operationType === 'complete'
      ? 'x'
      : input.operation.operationType === 'reopen'
        ? ' '
        : input.operation.task.status === 'completed'
          ? 'x'
          : ' ';
  const metadata = [
    priorityToEmoji(input.operation.task.priority),
    input.operation.task.dueAt
      ? `📅 ${input.operation.task.dueAt.slice(0, 10)}`
      : null,
    completionMetadata(checkbox, input.operation),
    ...preservedMetadata,
    ...input.operation.task.labels.map((label) => `#${sanitizeTag(label)}`)
  ].filter((value): value is string => Boolean(value));
  const suffix = blockId ? ` ^${blockId}` : '';
  const nextBody = [input.operation.task.title.trim(), ...metadata]
    .filter(Boolean)
    .join(' ');

  return `${match[1]}${checkbox}${match[3]}${nextBody}${suffix}`;
}

function findSourceLineIndex(
  lines: readonly string[],
  source: {
    lineNumber: number;
    lineHash: string;
    blockId: string | null;
  }
): number {
  const expectedIndex = source.lineNumber - 1;

  if (
    expectedIndex >= 0 &&
    expectedIndex < lines.length &&
    hashTaskLine(lines[expectedIndex] ?? '') === source.lineHash
  ) {
    return expectedIndex;
  }

  if (source.blockId) {
    const blockPattern = new RegExp(
      `(?:^|\\s)\\^${escapeRegExp(source.blockId)}\\s*$`
    );
    const blockIndex = lines.findIndex((line) => blockPattern.test(line));

    if (
      blockIndex !== -1 &&
      hashTaskLine(lines[blockIndex] ?? '') === source.lineHash
    ) {
      return blockIndex;
    }

    return -1;
  }

  return lines.findIndex((line) => hashTaskLine(line) === source.lineHash);
}

function isTFile(file: unknown): file is TFile {
  return Boolean(file && typeof file === 'object' && 'path' in file);
}

function extractBlockId(body: string): string | null {
  return BLOCK_ID_RE.exec(body)?.[1] ?? null;
}

function priorityToEmoji(priority: number): string | null {
  if (priority <= 1) {
    return '🔺';
  }
  if (priority === 2) {
    return '⏫';
  }
  if (priority === 3) {
    return '🔼';
  }
  return null;
}

function completionMetadata(
  checkbox: string,
  operation: PendingOperation
): string | null {
  if (checkbox !== 'x') {
    return null;
  }

  const completedAt =
    operation.operationType === 'complete'
      ? null
      : operation.source.completedAt;

  return `✅ ${(completedAt ?? new Date().toISOString()).slice(0, 10)}`;
}

function extractPreservedMetadata(body: string, nextPriority: number): string[] {
  return [
    ...new Set(
      [
        ...body.matchAll(RECURRENCE_RE),
        ...body.matchAll(UNSUPPORTED_TASKS_EMOJI_METADATA_RE),
        ...(nextPriority >= 4 ? body.matchAll(LOW_PRIORITY_METADATA_RE) : []),
        ...body.matchAll(UNSUPPORTED_DATAVIEW_FIELD_RE)
      ]
        .map((match) => match[0].trim())
        .filter(Boolean)
    )
  ];
}

function sanitizeTag(label: string): string {
  return label.trim().replace(/^#/, '').replace(/[^A-Za-z0-9/_-]+/g, '-');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
