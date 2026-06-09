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
    vaultId: input.currentVaultId || createVaultId(input.vaultName, vaultPath),
    vaultName: input.vaultName,
    vaultPath,
  };
}

function getVaultBasePath(adapter: unknown): string {
  if (hasBasePathAdapter(adapter)) {
    return String(adapter.getBasePath());
  }

  throw new Error(
    "Dainvo Task Manager requires Obsidian desktop vault access.",
  );
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

function createVaultId(vaultName: string, vaultPath: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `obsidian-${slug(vaultName)}-${slug(vaultPath).slice(0, 24)}-${random}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
