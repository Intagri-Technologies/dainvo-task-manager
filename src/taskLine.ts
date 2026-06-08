import { createHash } from "node:crypto";

import type { PendingMutationOperation } from "./types";

export type ParsedTaskLine = {
  title: string;
  status: "open" | "completed";
  priority: number;
  labels: string[];
  dueAt: string | null;
  completedAt: string | null;
  blockId: string | null;
  lineHash: string;
  rawTaskLine: string;
  parserFormat: "markdown" | "tasks";
};

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const DUE_DATE_RE = /(?:📅|\[due::)\s*(\d{4}-\d{2}-\d{2})\]?/;
const COMPLETION_DATE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const TAG_RE = /(?:^|\s)#([A-Za-z0-9/_-]+)/g;
const RECURRENCE_RE = /🔁\s+[^📅✅➕⏳🛫❌🔺⏫🔼🔽⏬#^]+/gu;
const UNSUPPORTED_TASKS_EMOJI_METADATA_RE =
  /(?:➕|⏳|🛫|❌)\s*\d{4}-\d{2}-\d{2}/gu;
const LOW_PRIORITY_METADATA_RE = /[🔽⏬]/gu;
const UNSUPPORTED_DATAVIEW_FIELD_RE =
  /\[(?!(?:due|completion|completed|done)::)[A-Za-z][A-Za-z0-9_-]*::\s*[^\]]+\]/gi;

export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = TASK_LINE_RE.exec(line);
  if (!match) {
    return null;
  }

  const body = match[4] ?? "";
  const status = match[2]?.toLowerCase() === "x" ? "completed" : "open";
  const dueAt = parseDueAt(body);
  const completedAt = status === "completed" ? parseCompletedAt(body) : null;
  const labels = parseTags(body);
  const priority = parsePriority(body);

  return {
    title: normalizeTaskTitle(body),
    status,
    priority,
    labels,
    dueAt,
    completedAt,
    blockId: extractBlockId(body),
    lineHash: hashTaskLine(line),
    rawTaskLine: line,
    parserFormat:
      dueAt || completedAt || labels.length > 0 || priority !== 4
        ? "tasks"
        : "markdown",
  };
}

export function hashTaskLine(line: string): string {
  return sha256(normalizeLineEndings(line));
}

export function patchMarkdownTaskLine(input: {
  existingLine: string;
  operation: PendingMutationOperation;
}): string | null {
  if (input.operation.operationType === "delete") {
    return null;
  }

  const match = TASK_LINE_RE.exec(input.existingLine);
  if (!match) {
    throw new Error("Source line is no longer a task.");
  }

  const body = match[4] ?? "";
  const blockId = extractBlockId(body);
  const preservedMetadata = extractPreservedMetadata(
    body,
    input.operation.task.priority,
  );
  const checkbox =
    input.operation.operationType === "complete"
      ? "x"
      : input.operation.operationType === "reopen"
        ? " "
        : input.operation.task.status === "completed"
          ? "x"
          : " ";
  const metadata = [
    priorityToEmoji(input.operation.task.priority),
    input.operation.task.dueAt
      ? `📅 ${input.operation.task.dueAt.slice(0, 10)}`
      : null,
    completionMetadata(checkbox, input.operation),
    ...preservedMetadata,
    ...input.operation.task.labels.map((label) => `#${sanitizeTag(label)}`),
  ].filter((value): value is string => Boolean(value));
  const suffix = blockId ? ` ^${blockId}` : "";
  const nextBody = [input.operation.task.title.trim(), ...metadata]
    .filter(Boolean)
    .join(" ");

  return `${match[1]}${checkbox}${match[3]}${nextBody}${suffix}`;
}

function normalizeTaskTitle(body: string): string {
  const title = body
    .replace(BLOCK_ID_RE, "")
    .replace(DUE_DATE_RE, "")
    .replace(COMPLETION_DATE_RE, "")
    .replace(RECURRENCE_RE, "")
    .replace(UNSUPPORTED_TASKS_EMOJI_METADATA_RE, "")
    .replace(LOW_PRIORITY_METADATA_RE, "")
    .replace(UNSUPPORTED_DATAVIEW_FIELD_RE, "")
    .replace(/[🔺⏫🔼]/gu, "")
    .replace(TAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  return title || "Untitled Obsidian task";
}

function parseDueAt(body: string): string | null {
  const due = DUE_DATE_RE.exec(body)?.[1];

  return due ? `${due}T00:00:00.000Z` : null;
}

function parseCompletedAt(body: string): string | null {
  const completed = COMPLETION_DATE_RE.exec(body)?.[1];

  return completed ? `${completed}T00:00:00.000Z` : null;
}

function parsePriority(body: string): number {
  if (body.includes("🔺")) {
    return 1;
  }

  if (body.includes("⏫")) {
    return 2;
  }

  if (body.includes("🔼")) {
    return 3;
  }

  return 4;
}

function priorityToEmoji(priority: number): string | null {
  if (priority <= 1) {
    return "🔺";
  }

  if (priority === 2) {
    return "⏫";
  }

  if (priority === 3) {
    return "🔼";
  }

  return null;
}

function completionMetadata(
  checkbox: string,
  operation: PendingMutationOperation,
): string | null {
  if (checkbox !== "x") {
    return null;
  }

  const completedAt =
    operation.operationType === "complete"
      ? null
      : operation.source.completedAt;

  return `✅ ${(completedAt ?? new Date().toISOString()).slice(0, 10)}`;
}

function extractPreservedMetadata(
  body: string,
  nextPriority: number,
): string[] {
  return [
    ...new Set(
      [
        ...body.matchAll(RECURRENCE_RE),
        ...body.matchAll(UNSUPPORTED_TASKS_EMOJI_METADATA_RE),
        ...(nextPriority >= 4 ? body.matchAll(LOW_PRIORITY_METADATA_RE) : []),
        ...body.matchAll(UNSUPPORTED_DATAVIEW_FIELD_RE),
      ]
        .map((match) => match[0].trim())
        .filter(Boolean),
    ),
  ];
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

function sanitizeTag(label: string): string {
  return label
    .trim()
    .replace(/^#/, "")
    .replace(/[^A-Za-z0-9/_-]+/g, "-");
}

function normalizeLineEndings(line: string): string {
  return line.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
