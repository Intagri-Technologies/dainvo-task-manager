import { buildOpenUri } from "./openUri";
import { sha256 } from "./sha256";
import { parseTaskLine } from "./taskLine";
import type { ObsidianSnapshotTask, ParsedTaskCandidate } from "./types";

export { buildOpenUri } from "./openUri";
export { hashTaskLine } from "./taskLine";

export type ParseMarkdownTasksInput = {
  vaultId: string;
  vaultName: string;
  notePath: string;
  content: string;
};

export function parseMarkdownTasks(
  input: ParseMarkdownTasksInput,
): ObsidianSnapshotTask[] {
  const notePath = normalizeNotePath(input.notePath);
  const noteTitle = notePath.split("/").pop()?.replace(/\.md$/i, "") ?? notePath;
  const tasks: ObsidianSnapshotTask[] = [];
  const hierarchyStack: Array<{
    indentColumns: number;
    providerTaskId: string;
  }> = [];
  const siblingCounts = new Map<string, number>();
  for (const candidate of findTaskCandidates(input.content)) {
    const parsed = candidate.parsed;
    const providerTaskId = buildProviderTaskId({
      vaultId: input.vaultId,
      notePath,
      lineNumber: candidate.lineNumber,
      blockId: parsed.blockId,
    });
    const indentColumns = countIndentColumns(candidate.line);
    while (
      hierarchyStack.length > 0 &&
      (hierarchyStack.at(-1)?.indentColumns ?? -1) >= indentColumns
    ) {
      hierarchyStack.pop();
    }
    const parentProviderTaskId =
      hierarchyStack.at(-1)?.providerTaskId ?? null;
    const siblingKey = parentProviderTaskId ?? "__root__";
    const siblingOrder = siblingCounts.get(siblingKey) ?? 0;
    siblingCounts.set(siblingKey, siblingOrder + 1);
    tasks.push({
      ...parsed,
      providerTaskId,
      notePath,
      noteTitle,
      heading: candidate.heading,
      lineNumber: candidate.lineNumber,
      openUri: buildOpenUri(input.vaultName, notePath, parsed.blockId),
      indentColumns,
      parentProviderTaskId,
      siblingOrder,
    });
    hierarchyStack.push({ indentColumns, providerTaskId });
  }

  return tasks;
}

function countIndentColumns(line: string): number {
  const whitespace = /^\s*/.exec(line)?.[0] ?? "";
  let columns = 0;
  for (const character of whitespace) {
    columns = character === "\t" ? columns + (4 - (columns % 4)) : columns + 1;
  }
  return columns;
}

export function findTaskCandidates(content: string): ParsedTaskCandidate[] {
  const lines = content.split(/\r?\n/);
  const tasks: ParsedTaskCandidate[] = [];
  let heading: string | null = null;
  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence = false;
  let fenceMarker = "";

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && (trimmed === "---" || trimmed === "...")) {
        inFrontmatter = false;
      }
      return;
    }

    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      return;
    }

    if (inFence) {
      return;
    }

    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[2]?.trim() || null;
      return;
    }

    const parsed = parseTaskLine(line);
    if (!parsed) {
      return;
    }

    tasks.push({
      lineNumber: index + 1,
      line,
      heading,
      parsed,
    });
  });

  return tasks;
}

export function buildProviderTaskId(input: {
  vaultId: string;
  notePath: string;
  lineNumber: number;
  blockId: string | null;
}): string {
  return input.blockId
    ? `${input.vaultId}:block:${input.blockId}`
    : `${input.vaultId}:line:${sha256(`${input.notePath}:${input.lineNumber}`)}`;
}

function normalizeNotePath(notePath: string): string {
  return notePath.replace(/\\/g, "/").replace(/^\/+/, "");
}
