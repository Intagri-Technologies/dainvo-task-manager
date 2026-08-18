import type {
  DainvoPluginSettings,
  ProjectNoteSettings,
} from "./types";

export function resolveProjectNoteSettings(
  settings: DainvoPluginSettings,
  exportedAt = new Date().toISOString(),
): ProjectNoteSettings {
  return {
    folder: normalizeProjectNoteFolder(settings.projectNoteFolder),
    exportedAt,
  };
}

export function normalizeProjectNoteFolder(value: string): string {
  const raw = value.trim().replace(/\\/g, "/");
  if (!raw) {
    return "Projects";
  }
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
    throw new Error("Project Notes folder must be relative to the vault.");
  }

  const segments = raw.split("/").filter(Boolean);
  if (segments.some(isUnsafeFolderSegment)) {
    throw new Error(
      "Project Notes folder contains a segment that is not cross-platform safe.",
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
