import { createHash } from "node:crypto";
import path from "node:path";

import { buildOpenUri } from "./openUri";
import { parseTaskLine } from "./taskLine";
import type { ObsidianSnapshotTask } from "./types";

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
  const lines = input.content.split(/\r?\n/);
  const noteTitle = path.basename(notePath, path.extname(notePath));
  const tasks: ObsidianSnapshotTask[] = [];
  let heading: string | null = null;

  lines.forEach((line, index) => {
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
      ...parsed,
      providerTaskId: buildProviderTaskId({
        vaultId: input.vaultId,
        notePath,
        lineNumber: index + 1,
        blockId: parsed.blockId,
      }),
      notePath,
      noteTitle,
      heading,
      lineNumber: index + 1,
      openUri: buildOpenUri(input.vaultName, notePath, parsed.blockId),
    });
  });

  return tasks;
}

function buildProviderTaskId(input: {
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
