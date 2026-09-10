// Links that open something in Dainvo desktop from Obsidian. Pure module so
// the builders and path rules are unit-tested without the Obsidian runtime.

export type DainvoDeepLinkScheme = "dainvo" | "dainvo-dev";

// Mirrors the desktop parsers: vault ids are `obsidian-<uuid>` or a legacy
// opaque id, block ids are `d-XXXXXX`, `dainvo-<uuid>`, or a user-authored
// Obsidian block id, and Project ids are `project_<uuid>`.
const VAULT_ID_RE = /^[A-Za-z0-9-]{8,80}$/;
const BLOCK_ID_RE = /^[A-Za-z0-9-]{1,80}$/;
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

export function normalizeDeepLinkScheme(value: unknown): DainvoDeepLinkScheme {
  return value === "dainvo-dev" ? "dainvo-dev" : "dainvo";
}

export function buildObsidianTaskDeepLink(input: {
  scheme: DainvoDeepLinkScheme;
  vaultId: string;
  blockId: string;
}): string {
  if (!VAULT_ID_RE.test(input.vaultId) || !BLOCK_ID_RE.test(input.blockId)) {
    throw new Error("The task identity is not valid for a Dainvo link.");
  }
  return `${input.scheme}://obsidian/task/${input.vaultId}/${input.blockId}`;
}

export function buildProjectDeepLink(input: {
  scheme: DainvoDeepLinkScheme;
  projectId: string;
}): string {
  if (!PROJECT_ID_RE.test(input.projectId)) {
    throw new Error("The project identity is not valid for a Dainvo link.");
  }
  return `${input.scheme}://entity/project/${input.projectId}`;
}

// Same rule as the stable-ID journal: trailing whitespace goes, the block id
// is always the last token on the line.
export function appendBlockIdToTaskLine(line: string, blockId: string): string {
  return `${line.replace(/\s+$/, "")} ^${blockId}`;
}

export function isPathUnderFolder(notePath: string, folder: string): boolean {
  const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedFolder) {
    return false;
  }
  const normalizedPath = notePath.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedFolder}/`);
}
