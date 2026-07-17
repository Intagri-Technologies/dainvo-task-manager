export type VaultIdentity = {
  vaultId: string;
  vaultName: string;
  vaultPath: string;
};

export function resolveVaultIdentity(input: {
  adapter: unknown;
  vaultName: string;
  currentVaultId: string;
}): VaultIdentity {
  const vaultPath = getVaultBasePath(input.adapter);

  return {
    // Preserve every existing ID, including legacy path-derived IDs. New IDs
    // are opaque so a filesystem path can never leak through an identifier.
    vaultId: input.currentVaultId || createVaultId(),
    vaultName: input.vaultName,
    vaultPath,
  };
}

function getVaultBasePath(adapter: unknown): string {
  if (hasBasePathAdapter(adapter)) {
    return String(adapter.getBasePath());
  }

  return "";
}

function hasBasePathAdapter(adapter: unknown): adapter is {
  getBasePath(): string;
} {
  return Boolean(
    adapter &&
      typeof adapter === "object" &&
      "getBasePath" in adapter &&
      typeof (adapter as { getBasePath?: unknown }).getBasePath === "function",
  );
}

function createVaultId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure random UUID generation is unavailable.");
  }

  return `obsidian-${globalThis.crypto.randomUUID()}`;
}
