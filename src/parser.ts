import { createHash } from 'node:crypto';
import path from 'node:path';

import type { ObsidianSnapshotTask } from './types';

export type ParseMarkdownTasksInput = {
  vaultId: string;
  vaultName: string;
  notePath: string;
  content: string;
};

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const DUE_DATE_RE = /(?:📅|\[due::)\s*(\d{4}-\d{2}-\d{2})\]?/;
const COMPLETION_DATE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const TAG_RE = /(?:^|\s)#([A-Za-z0-9/_-]+)/g;
const RECURRENCE_RE = /🔁\s+[^📅✅➕⏳🛫🔺⏫🔼🔽⏬#^]+/;

export function parseMarkdownTasks(
  input: ParseMarkdownTasksInput
): ObsidianSnapshotTask[] {
  const lines = input.content.split(/\r?\n/);
  const noteTitle = path.basename(input.notePath, path.extname(input.notePath));
  const tasks: ObsidianSnapshotTask[] = [];
  let heading: string | null = null;

  lines.forEach((line, index) => {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[2]?.trim() || null;
      return;
    }

    const match = TASK_LINE_RE.exec(line);
    if (!match) {
      return;
    }

    const body = match[4] ?? '';
    const blockId = extractBlockId(body);
    const status = match[2]?.toLowerCase() === 'x' ? 'completed' : 'open';
    const dueAt = parseDueAt(body);
    const labels = parseTags(body);
    const completedAt =
      status === 'completed' ? parseCompletedAt(body) : null;

    tasks.push({
      providerTaskId: blockId
        ? `${input.vaultId}:block:${blockId}`
        : `${input.vaultId}:line:${sha256(`${input.notePath}:${index + 1}`)}`,
      title: normalizeTaskTitle(body),
      status,
      priority: parsePriority(body),
      labels,
      dueAt,
      completedAt,
      notePath: normalizeNotePath(input.notePath),
      noteTitle,
      heading,
      lineNumber: index + 1,
      blockId,
      lineHash: hashTaskLine(line),
      rawTaskLine: line,
      openUri: buildOpenUri(input.vaultName, input.notePath, blockId),
      parserFormat:
        dueAt || completedAt || labels.length > 0 || parsePriority(body) !== 4
          ? 'tasks'
          : 'markdown'
    });
  });

  return tasks;
}

export function hashTaskLine(line: string): string {
  return sha256(line.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
}

export function buildOpenUri(
  vaultName: string,
  notePath: string,
  blockId?: string | null
): string {
  const url = new URL('obsidian://open');
  url.searchParams.set('vault', vaultName);
  url.searchParams.set('file', normalizeNotePath(notePath));

  if (blockId) {
    url.searchParams.set('block', blockId);
  }

  return url.toString();
}

function normalizeTaskTitle(body: string): string {
  const title = body
    .replace(BLOCK_ID_RE, '')
    .replace(DUE_DATE_RE, '')
    .replace(COMPLETION_DATE_RE, '')
    .replace(RECURRENCE_RE, '')
    .replace(/[🔺⏫🔼🔽⏬]/g, '')
    .replace(TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return title || 'Untitled Obsidian task';
}

function parseDueAt(body: string): string | null {
  const due = DUE_DATE_RE.exec(body)?.[1];
  return due ? `${due}T00:00:00.000Z` : null;
}

function parseCompletedAt(body: string): string | null {
  const completed = COMPLETION_DATE_RE.exec(body)?.[1];
  return completed ? `${completed}T00:00:00.000Z` : new Date().toISOString();
}

function parsePriority(body: string): number {
  if (body.includes('🔺')) {
    return 1;
  }
  if (body.includes('⏫')) {
    return 2;
  }
  if (body.includes('🔼')) {
    return 3;
  }
  return 4;
}

function parseTags(body: string): string[] {
  const labels = new Set<string>();
  for (const match of body.matchAll(TAG_RE)) {
    const label = match[1]?.trim();
    if (label) {
      labels.add(label);
    }
  }
  return [...labels];
}

function extractBlockId(body: string): string | null {
  return BLOCK_ID_RE.exec(body)?.[1] ?? null;
}

function normalizeNotePath(notePath: string): string {
  return notePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

