import type { PendingMutationOperation } from "./types";
import { sha256 } from "./sha256";

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
  isBlank: boolean;
};

export const OBSIDIAN_BLANK_TASK_TITLE = "Untitled Obsidian task";

// Any one status character is a task. `[x]`/`[X]` are done, `[-]` is
// cancelled, which Tasks counts as done; `[/]` (in progress) and every other
// character are open. https://publish.obsidian.md/tasks/Getting+Started/Statuses
const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([^\]\r\n])(\](?:\s+|$))(.*)$/;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const DUE_DATE_RE = /(?:📅|\[due::)\s*(\d{4}-\d{2}-\d{2})\]?/;
// `✅ YYYY-MM-DD` or the Dataview form `[completion:: YYYY-MM-DD]`.
// https://publish.obsidian.md/tasks/Getting+Started/Dates
// https://publish.obsidian.md/tasks/Reference/Task+Formats/Dataview+Format
const COMPLETION_DATE_RE =
  /(?:✅|\[(?:completion|completed|done)::)\s*(\d{4}-\d{2}-\d{2})\]?/u;
const COMPLETION_TOKEN_RE =
  /\s*(?:✅\s*\d{4}-\d{2}-\d{2}|\[(?:completion|completed|done)::\s*\d{4}-\d{2}-\d{2}\])/gu;
const DUE_TOKEN_RE = /\s*(?:📅\s*\d{4}-\d{2}-\d{2}|\[due::\s*\d{4}-\d{2}-\d{2}\])/u;
// Tags take Unicode letters, numbers, emoji, `_`, `-` and `/`, and need at
// least one character that is not a number. https://obsidian.md/help/tags
const TAG_CHARS = "[\\p{L}\\p{N}\\p{Extended_Pictographic}_/-]";
const TAG_RE = new RegExp(
  `(?:^|\\s)#(?!\\d+(?!${TAG_CHARS}))(${TAG_CHARS}+)`,
  "gu",
);
const RECURRENCE_RE = /🔁\s+[^📅✅➕⏳🛫❌🔺⏫🔼🔽⏬#^]+/gu;
const UNSUPPORTED_TASKS_EMOJI_METADATA_RE =
  /(?:➕|⏳|🛫|❌)\s*\d{4}-\d{2}-\d{2}/gu;
const LOW_PRIORITY_METADATA_RE = /[🔽⏬]/gu;
const PRIORITY_TOKEN_RE = /\s*[🔺⏫🔼🔽⏬]/gu;
const UNSUPPORTED_DATAVIEW_FIELD_RE =
  /\[(?!(?:due|completion|completed|done)::)[A-Za-z][A-Za-z0-9_-]*::\s*[^\]]+\]/gi;
// A line in the Tasks Dataview format keeps it for the dates we add.
const TASKS_DATAVIEW_FIELD_RE =
  /\[(?:due|completion|completed|done|scheduled|start|created|cancelled|priority|repeat)::/;
const TASKS_EMOJI_RE = /[📅✅⏳🛫➕❌🔁]/u;
const METADATA_START_RE = new RegExp(
  `(?:^|\\s)(?:#${TAG_CHARS}|[📅✅🔁➕⏳🛫❌🔺⏫🔼🔽⏬]|\\[[A-Za-z][A-Za-z0-9_-]*::|\\^[A-Za-z0-9-]+\\s*$)`,
  "u",
);

export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = TASK_LINE_RE.exec(line);
  if (!match) {
    return null;
  }

  const body = match[4] ?? "";
  const title = normalizeTaskTitle(body);
  const isBlank = !title;

  const status = checkboxStatus(match[2] ?? " ");
  const dueAt = parseDueAt(body);
  const completedAt = status === "completed" ? parseCompletedAt(body) : null;
  const labels = parseTags(body);
  const priority = parsePriority(body);

  return {
    title: title || OBSIDIAN_BLANK_TASK_TITLE,
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
    isBlank,
  };
}

export function checkboxStatus(character: string): "open" | "completed" {
  return character === "x" || character === "X" || character === "-"
    ? "completed"
    : "open";
}

export function hashTaskLine(line: string): string {
  return sha256(normalizeLineEndings(line));
}

/**
 * Changes only what the operation changes: the checkbox and its completion
 * date, and for an update the title span, priority, due date and tags that
 * differ. Everything else on the line stays byte for byte, including the
 * status character when the status does not change and the line's own date
 * format. A line the in-place patch cannot express is rebuilt as before.
 */
export function patchMarkdownTaskLine(input: {
  existingLine: string;
  operation: PendingMutationOperation;
  now?: Date;
}): string | null {
  if (input.operation.operationType === "delete") {
    return null;
  }

  const match = TASK_LINE_RE.exec(input.existingLine);
  const parsed = parseTaskLine(input.existingLine);
  if (!match || !parsed) {
    throw new Error("Source line is no longer a task.");
  }

  const desiredStatus = desiredTaskStatus(input.operation);
  const patched = patchLineInPlace(
    match,
    parsed,
    input.operation,
    desiredStatus,
    input.now ?? new Date(),
  );
  if (
    patched !== null &&
    lineMatchesOperation(patched, input.operation, desiredStatus)
  ) {
    return patched;
  }
  return rebuildTaskLine(match, input.operation, desiredStatus, input.now);
}

/** The local calendar date, the day the person sees when they tick a task. */
export function localDateKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function desiredTaskStatus(
  operation: PendingMutationOperation,
): "open" | "completed" {
  return operation.operationType === "complete"
    ? "completed"
    : operation.operationType === "reopen"
      ? "open"
      : operation.task.status === "completed"
        ? "completed"
        : "open";
}

function patchLineInPlace(
  match: RegExpExecArray,
  parsed: ParsedTaskLine,
  operation: PendingMutationOperation,
  desiredStatus: "open" | "completed",
  now: Date,
): string | null {
  let checkbox = match[2] ?? " ";
  let body = match[4] ?? "";

  if (parsed.status !== desiredStatus) {
    checkbox = desiredStatus === "completed" ? "x" : " ";
    body =
      desiredStatus === "completed"
        ? insertToken(body, completionToken(body, localDateKey(now)))
        : body.replace(COMPLETION_TOKEN_RE, "");
  }

  if (operation.operationType === "update") {
    const wantDue = operation.task.dueAt?.slice(0, 10) ?? null;
    const haveDue = parsed.dueAt?.slice(0, 10) ?? null;
    if (wantDue !== haveDue) {
      body = !wantDue
        ? body.replace(DUE_TOKEN_RE, "")
        : haveDue
          ? body.replace(
              /(📅\s*|\[due::\s*)\d{4}-\d{2}-\d{2}/u,
              `$1${wantDue}`,
            )
          : insertToken(body, dueToken(body, wantDue));
    }

    const wantPriority = normalizePriority(operation.task.priority);
    if (wantPriority !== parsed.priority) {
      body = body.replace(PRIORITY_TOKEN_RE, "");
      const emoji = priorityToEmoji(wantPriority);
      if (emoji) body = insertToken(body, emoji);
    }

    const wantTags = new Set(operation.task.labels.map(sanitizeTag));
    for (const label of parsed.labels) {
      if (!wantTags.has(label)) body = removeTag(body, label);
    }
    for (const tag of wantTags) {
      if (tag && !parsed.labels.includes(tag)) {
        body = insertToken(body, `#${tag}`);
      }
    }

    const wantTitle = operation.task.title.trim();
    if (
      wantTitle &&
      wantTitle !== parsed.title &&
      !(parsed.isBlank && wantTitle === OBSIDIAN_BLANK_TASK_TITLE)
    ) {
      const retitled = replaceLeadingTitle(body, parsed.title, wantTitle);
      if (retitled === null) return null;
      body = retitled;
    }
  }

  const separator = match[3] === "]" && body ? "] " : (match[3] ?? "] ");
  return `${match[1]}${checkbox}${separator}${body}`;
}

function lineMatchesOperation(
  line: string,
  operation: PendingMutationOperation,
  desiredStatus: "open" | "completed",
): boolean {
  const parsed = parseTaskLine(line);
  if (!parsed || parsed.status !== desiredStatus) return false;
  if (operation.operationType !== "update") return true;
  const wantTitle = operation.task.title.trim() || OBSIDIAN_BLANK_TASK_TITLE;
  const labels = new Set(operation.task.labels.map(sanitizeTag));
  return (
    parsed.title === wantTitle &&
    parsed.priority === normalizePriority(operation.task.priority) &&
    (parsed.dueAt?.slice(0, 10) ?? null) ===
      (operation.task.dueAt?.slice(0, 10) ?? null) &&
    parsed.labels.length === labels.size &&
    parsed.labels.every((label) => labels.has(label))
  );
}

function rebuildTaskLine(
  match: RegExpExecArray,
  operation: PendingMutationOperation,
  desiredStatus: "open" | "completed",
  now: Date = new Date(),
): string {
  const body = match[4] ?? "";
  const blockId = extractBlockId(body);
  const preservedMetadata = extractPreservedMetadata(
    body,
    operation.task.priority,
  );
  const wasCompleted = checkboxStatus(match[2] ?? " ") === "completed";
  const checkbox =
    desiredStatus === "completed"
      ? wasCompleted
        ? (match[2] ?? "x")
        : "x"
      : wasCompleted
        ? " "
        : (match[2] ?? " ");
  const existingCompletion = COMPLETION_DATE_RE.exec(body)?.[1] ?? null;
  const metadata = [
    priorityToEmoji(operation.task.priority),
    operation.task.dueAt ? `📅 ${operation.task.dueAt.slice(0, 10)}` : null,
    desiredStatus === "completed"
      ? `✅ ${(wasCompleted && existingCompletion) || operation.source.completedAt?.slice(0, 10) || localDateKey(now)}`
      : null,
    ...preservedMetadata,
    ...operation.task.labels.map((label) => `#${sanitizeTag(label)}`),
  ].filter((value): value is string => Boolean(value));
  const suffix = blockId ? ` ^${blockId}` : "";
  const nextBody = [operation.task.title.trim(), ...metadata]
    .filter(Boolean)
    .join(" ");

  const separator = match[3] === "]" ? "] " : match[3];
  return `${match[1]}${checkbox}${separator}${nextBody}${suffix}`;
}

/** Puts a token at the end of the line's text, before a trailing block id. */
function insertToken(body: string, token: string): string {
  const blockMatch = BLOCK_ID_RE.exec(body);
  const head = blockMatch ? body.slice(0, blockMatch.index) : body;
  const tail = blockMatch ? ` ^${blockMatch[1]}` : "";
  const text = head.replace(/\s+$/, "");
  return `${text ? `${text} ` : ""}${token}${tail}`;
}

function usesDataviewFormat(body: string): boolean {
  return !TASKS_EMOJI_RE.test(body) && TASKS_DATAVIEW_FIELD_RE.test(body);
}

function completionToken(body: string, date: string): string {
  return usesDataviewFormat(body) ? `[completion:: ${date}]` : `✅ ${date}`;
}

function dueToken(body: string, date: string): string {
  return usesDataviewFormat(body) ? `[due:: ${date}]` : `📅 ${date}`;
}

function removeTag(body: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body
    .replace(new RegExp(`\\s#${escaped}(?!${TAG_CHARS})`, "gu"), "")
    .replace(new RegExp(`^#${escaped}(?!${TAG_CHARS})\\s*`, "u"), "");
}

/** Replaces the text before the first metadata token when it is the whole title. */
function replaceLeadingTitle(
  body: string,
  currentTitle: string,
  nextTitle: string,
): string | null {
  const metadataStart = METADATA_START_RE.exec(body);
  const end = metadataStart ? metadataStart.index : body.length;
  const lead = body.slice(0, end);
  if (lead.replace(/\s+/g, " ").trim() !== currentTitle) return null;
  const rest = body.slice(end);
  return `${nextTitle}${rest ? (/^\s/.test(rest) ? rest : ` ${rest}`) : ""}`;
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

  return title;
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

function normalizePriority(priority: number): number {
  return Number.isInteger(priority) && priority >= 1 && priority <= 4
    ? priority
    : 4;
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
    .replace(new RegExp(`[^${TAG_CHARS.slice(1, -1)}]+`, "gu"), "-");
}

function normalizeLineEndings(line: string): string {
  return line.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
