import type {
  DainvoPluginSettings,
  ItemNoteSettings,
} from "./types";

export function resolveItemNoteSettings(
  settings: DainvoPluginSettings,
  exportedAt = new Date().toISOString(),
): ItemNoteSettings {
  return {
    placement: settings.itemNotePlacement,
    folder: normalizeItemNoteFolder(settings.itemNoteFolder),
    useDayFolder:
      settings.itemNotePlacement === "dedicated-folder" &&
      settings.itemNoteUseDayFolder,
    includeStartTime: settings.itemNoteIncludeStartTime,
    initialContent: settings.itemNoteInitialContent,
    exportedAt,
  };
}

export function normalizeItemNoteFolder(value: string): string {
  const raw = value.trim().replace(/\\/g, "/");
  if (!raw) {
    return "Item Notes";
  }
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
    throw new Error("Item Notes folder must be relative to the vault.");
  }

  const segments = raw.split("/").filter(Boolean);
  if (segments.some(isUnsafeFolderSegment)) {
    throw new Error(
      "Item Notes folder contains a segment that is not cross-platform safe.",
    );
  }
  return segments.join("/");
}

function isUnsafeFolderSegment(segment: string): boolean {
  return (
    segment === "." ||
    segment === ".." ||
    /[<>:"|?*]/.test(segment) ||
    Array.from(segment).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    }) ||
    /[. ]$/.test(segment) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ||
    new TextEncoder().encode(segment).byteLength > 200
  );
}
