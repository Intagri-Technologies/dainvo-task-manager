export function buildOpenUri(
  vaultName: string,
  notePath: string,
  blockId?: string | null,
): string {
  return buildObsidianOpenUri({
    vault: vaultName,
    file: buildOpenFileTarget(notePath, blockId),
  });
}

function buildOpenFileTarget(
  notePath: string,
  blockId?: string | null,
): string {
  const normalizedNotePath = normalizeNotePath(notePath);

  return blockId ? `${normalizedNotePath}#^${blockId}` : normalizedNotePath;
}

function buildObsidianOpenUri(params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");

  return `obsidian://open?${query}`;
}

function normalizeNotePath(notePath: string): string {
  return notePath.replace(/\\/g, "/").replace(/^\/+/, "");
}
