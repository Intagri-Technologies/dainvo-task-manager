import { normalizePath, type TFile, type Vault } from "obsidian";

import { findTaskCandidates } from "./parser";
import { sha256 } from "./sha256";
import { hashTaskLine } from "./taskLine";
import type {
  DainvoPluginSettings,
  FutureTaskIndexEntry,
  StableIdJournal,
  StableIdJournalIntent,
  StableIdMode,
} from "./types";

export type StableIdResult = {
  changed: number;
  duplicateCount: number;
  baselineCreated: boolean;
};

export type StableIdWriteGuard = (candidate: {
  notePath: string;
  lineNumber: number;
}) => boolean;

const STABLE_ID_PREFIX = "d-";
const STABLE_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const STABLE_ID_SUFFIX_LENGTH = 6;
const ORPHANED_DAINVO_ID_TASK_RE =
  /^(\s*[-*+]\s+\[[ xX]\])\s+\^(?:dainvo|d)-[A-Za-z0-9-]+\s*$/;

export class StableIdCoordinator {
  constructor(
    private readonly vault: Vault,
    private readonly getSettings: () => DainvoPluginSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly shouldDeferWrite: StableIdWriteGuard = () => false,
  ) {}

  async countBackfillCandidates(): Promise<number> {
    const scan = await this.scanVault();
    return scan.missing.length + scan.duplicates.length;
  }

  async normalize(input: {
    mode: StableIdMode;
    deviceId: string;
    forceBackfill?: boolean;
    resetFutureBaseline?: boolean;
  }): Promise<StableIdResult> {
    if (this.getSettings().stableIdJournal) {
      await this.finishJournal();
    }

    const repairedOrphans = await this.repairOrphanedDainvoIds();
    const scan = await this.scanVault();
    const settings = this.getSettings();
    settings.duplicateStableIdCount = scan.duplicates.length;
    const allocateStableId = createStableIdAllocator(scan.blockIds);

    const shouldBackfill =
      input.mode === "backfill_and_future" || input.forceBackfill === true;
    let intents: StableIdJournalIntent[] = [];
    let baselineCreated = false;
    const deferredMissing = new Set<string>();

    if (shouldBackfill) {
      intents = [
        ...scan.missing.flatMap((candidate) => {
          if (this.shouldDefer(candidate)) {
            deferredMissing.add(candidateFingerprint(candidate));
            return [];
          }
          return [makeIntent(candidate, null, allocateStableId())];
        }),
        ...scan.duplicates.flatMap((candidate) =>
          this.shouldDefer(candidate)
            ? []
            : [
                makeIntent(
                  candidate,
                  candidate.blockId,
                  allocateStableId(),
                ),
              ],
        ),
      ];
    } else {
      const copiedDainvoIds = scan.duplicates
        .filter((candidate) => isDainvoOwnedBlockId(candidate.blockId))
        .filter((candidate) => !this.shouldDefer(candidate))
        .map((candidate) =>
          makeIntent(candidate, candidate.blockId, allocateStableId()),
        );
      const needsBaseline =
        input.resetFutureBaseline === true ||
        settings.futureTaskBaselineDeviceId !== input.deviceId;
      if (needsBaseline) {
        settings.futureTaskIndex = buildFutureIndex(scan.missing);
        settings.futureTaskBaselineDeviceId = input.deviceId;
        baselineCreated = true;
        await this.saveSettings();
        if (copiedDainvoIds.length === 0) {
          return {
            changed: repairedOrphans,
            duplicateCount: scan.duplicates.length,
            baselineCreated,
          };
        }
      }

      const newFutureTasks = needsBaseline
        ? []
        : findNewFutureTasks(scan.missing, settings.futureTaskIndex);
      intents = [
        ...copiedDainvoIds,
        ...newFutureTasks.flatMap((candidate) => {
          if (this.shouldDefer(candidate)) {
            deferredMissing.add(candidateFingerprint(candidate));
            return [];
          }
          return [makeIntent(candidate, null, allocateStableId())];
        }),
      ];
    }

    if (intents.length > 0) {
      const journal: StableIdJournal = {
        id: secureUuid(),
        createdAt: new Date().toISOString(),
        mode: input.mode,
        intents,
        completedFiles: [],
      };
      settings.stableIdJournal = journal;
      await this.saveSettings();
      await this.finishJournal();
    }

    const refreshed = await this.scanVault();
    const indexedMissing =
      input.mode === "future_only"
        ? excludeDeferredFutureTasks(
            refreshed.missing,
            settings.futureTaskIndex,
            deferredMissing,
            (candidate) => this.shouldDefer(candidate),
          )
        : refreshed.missing;
    settings.futureTaskIndex = buildFutureIndex(indexedMissing);
    settings.futureTaskBaselineDeviceId = input.deviceId;
    settings.duplicateStableIdCount = refreshed.duplicates.length;
    await this.saveSettings();

    return {
      changed: intents.length + repairedOrphans,
      duplicateCount: refreshed.duplicates.length,
      baselineCreated,
    };
  }

  async finishJournal(): Promise<void> {
    const settings = this.getSettings();
    const journal = settings.stableIdJournal;
    if (!journal) {
      return;
    }

    const paths = [
      ...new Set(journal.intents.map((intent) => normalizePath(intent.notePath))),
    ].sort((left, right) => left.localeCompare(right));

    for (const path of paths) {
      if (journal.completedFiles.includes(path)) {
        continue;
      }
      const file = this.vault.getAbstractFileByPath(path);
      if (!isMarkdownFile(file)) {
        throw new Error("stable_id_note_missing");
      }
      const fileIntents = journal.intents.filter(
        (intent) => normalizePath(intent.notePath) === path,
      );

      await this.vault.process(file, (content) =>
        applyIntentsToContent(content, fileIntents),
      );

      for (const intent of fileIntents) {
        if (
          intent.previousNotePath &&
          intent.previousLineNumber &&
          !intent.replaceBlockId
        ) {
          settings.identityAliases[intent.newBlockId] = {
            blockId: intent.newBlockId,
            notePath: intent.previousNotePath,
            lineNumber: intent.previousLineNumber,
            cloudPending: true,
            bridgePending: true,
          };
        }
      }
      journal.completedFiles.push(path);
      settings.stableIdJournal = journal;
      await this.saveSettings();
    }

    settings.stableIdJournal = null;
    await this.saveSettings();
  }

  private shouldDefer(candidate: StableIdCandidate): boolean {
    return this.shouldDeferWrite({
      notePath: candidate.notePath,
      lineNumber: candidate.lineNumber,
    });
  }

  private async repairOrphanedDainvoIds(): Promise<number> {
    let changed = 0;
    const files = this.vault
      .getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path));

    for (const file of files) {
      const notePath = normalizePath(file.path);
      const cached = await this.vault.cachedRead(file);
      const preview = stripOrphanedDainvoIds(cached, (lineNumber) =>
        this.shouldDeferWrite({ notePath, lineNumber }),
      );
      if (preview.changed === 0) {
        continue;
      }

      let fileChanged = 0;
      await this.vault.process(file, (content) => {
        const repaired = stripOrphanedDainvoIds(content, (lineNumber) =>
          this.shouldDeferWrite({ notePath, lineNumber }),
        );
        fileChanged = repaired.changed;
        return repaired.content;
      });
      changed += fileChanged;
    }

    return changed;
  }

  private async scanVault(): Promise<StableIdScan> {
    const all: StableIdCandidate[] = [];
    const files = this.vault
      .getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path));

    for (const file of files) {
      const content = await this.vault.cachedRead(file);
      for (const candidate of findTaskCandidates(content)) {
        all.push({
          notePath: normalizePath(file.path),
          lineNumber: candidate.lineNumber,
          lineHash: candidate.parsed.lineHash,
          titleHash: sha256(candidate.parsed.title),
          blockId: candidate.parsed.blockId,
        });
      }
    }

    const owners = new Map<string, StableIdCandidate>();
    const missing: StableIdCandidate[] = [];
    const duplicates: StableIdCandidate[] = [];
    for (const candidate of all) {
      if (!candidate.blockId) {
        missing.push(candidate);
        continue;
      }
      if (owners.has(candidate.blockId)) {
        duplicates.push(candidate);
      } else {
        owners.set(candidate.blockId, candidate);
      }
    }
    return {
      missing,
      duplicates,
      blockIds: new Set(
        all.flatMap((candidate) =>
          candidate.blockId ? [candidate.blockId] : [],
        ),
      ),
    };
  }
}

type StableIdCandidate = {
  notePath: string;
  lineNumber: number;
  lineHash: string;
  titleHash: string;
  blockId: string | null;
};

type StableIdScan = {
  missing: StableIdCandidate[];
  duplicates: StableIdCandidate[];
  blockIds: Set<string>;
};

function makeIntent(
  candidate: StableIdCandidate,
  replaceBlockId: string | null,
  newBlockId: string,
): StableIdJournalIntent {
  return {
    notePath: candidate.notePath,
    lineNumber: candidate.lineNumber,
    expectedLineHash: candidate.lineHash,
    newBlockId,
    previousNotePath: replaceBlockId ? null : candidate.notePath,
    previousLineNumber: replaceBlockId ? null : candidate.lineNumber,
    replaceBlockId,
  };
}

export function createStableIdAllocator(
  existingBlockIds: Iterable<string>,
  nextSuffix: () => string = secureStableIdSuffix,
): () => string {
  const used = new Set(existingBlockIds);
  return () => {
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const suffix = nextSuffix();
      if (!/^[A-Za-z0-9]{6}$/.test(suffix)) {
        throw new Error("stable_id_invalid_suffix");
      }
      const blockId = `${STABLE_ID_PREFIX}${suffix}`;
      if (!used.has(blockId)) {
        used.add(blockId);
        return blockId;
      }
    }
    throw new Error("stable_id_allocation_exhausted");
  };
}

export function stripOrphanedDainvoIds(
  content: string,
  shouldDefer: (lineNumber: number) => boolean = () => false,
): { content: string; changed: number } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(content);
  const lines = content.split(/\r?\n/);
  if (hadFinalNewline) {
    lines.pop();
  }

  let changed = 0;
  const repaired = lines.map((line, index) => {
    const match = ORPHANED_DAINVO_ID_TASK_RE.exec(line);
    if (!match || shouldDefer(index + 1)) {
      return line;
    }
    changed += 1;
    return match[1] ?? line;
  });

  return {
    content:
      repaired.join(eol) + (hadFinalNewline && repaired.length ? eol : ""),
    changed,
  };
}

export function applyIntentsToContent(
  content: string,
  intents: readonly StableIdJournalIntent[],
): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(content);
  const lines = content.split(/\r?\n/);
  if (hadFinalNewline) {
    lines.pop();
  }

  for (const intent of [...intents].sort((a, b) => b.lineNumber - a.lineNumber)) {
    const alreadyApplied = lines.findIndex((line) =>
      new RegExp(`(?:^|\\s)\\^${escapeRegExp(intent.newBlockId)}\\s*$`).test(line),
    );
    if (alreadyApplied !== -1) {
      continue;
    }

    const expectedIndex = intent.lineNumber - 1;
    const exactAtLine =
      expectedIndex >= 0 &&
      expectedIndex < lines.length &&
      hashTaskLine(lines[expectedIndex] ?? "") === intent.expectedLineHash;
    const hashMatches = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => hashTaskLine(line) === intent.expectedLineHash);
    const lineIndex = exactAtLine
      ? expectedIndex
      : hashMatches.length === 1
        ? (hashMatches[0]?.index ?? -1)
        : -1;
    if (lineIndex < 0) {
      throw new Error("stable_id_task_changed");
    }

    const line = lines[lineIndex] ?? "";
    // Re-parse the complete current note inside Vault.process(). Parsing the
    // line alone loses frontmatter/fence context and could insert an ID into a
    // task example that became unsupported after the journal was created.
    const candidate = findTaskCandidates(lines.join(eol)).find(
      (current) => current.lineNumber === lineIndex + 1,
    );
    if (!candidate || candidate.parsed.lineHash !== hashTaskLine(line)) {
      throw new Error("stable_id_unsupported_line");
    }

    if (intent.replaceBlockId) {
      const blockPattern = new RegExp(
        `(?:^|\\s)\\^${escapeRegExp(intent.replaceBlockId)}\\s*$`,
      );
      if (!blockPattern.test(line)) {
        throw new Error("stable_id_duplicate_changed");
      }
      lines[lineIndex] = line.replace(
        blockPattern,
        ` ^${intent.newBlockId}`,
      );
    } else {
      if (candidate.parsed.blockId) {
        throw new Error("stable_id_task_already_owned");
      }
      lines[lineIndex] = `${line.replace(/\s+$/, "")} ^${intent.newBlockId}`;
    }
  }

  return lines.join(eol) + (hadFinalNewline && lines.length ? eol : "");
}

function buildFutureIndex(
  candidates: readonly StableIdCandidate[],
): Record<string, FutureTaskIndexEntry[]> {
  const index: Record<string, FutureTaskIndexEntry[]> = {};
  for (const candidate of candidates) {
    (index[candidate.notePath] ??= []).push({
      lineNumber: candidate.lineNumber,
      lineHash: candidate.lineHash,
      titleHash: candidate.titleHash,
    });
  }
  return index;
}

function findNewFutureTasks(
  candidates: readonly StableIdCandidate[],
  previousIndex: Record<string, FutureTaskIndexEntry[]>,
): StableIdCandidate[] {
  const unmatched = new Set(candidates);
  const previous = Object.entries(previousIndex).flatMap(([notePath, entries]) =>
    entries.map((entry) => ({ ...entry, notePath })),
  );

  // An unchanged task moved to another note is not newly created. Match its
  // exact line fingerprint across the whole vault before using path-local
  // heuristics for edits and line shifts.
  matchCandidates(unmatched, previous, (candidate, entry) =>
    candidate.lineHash === entry.lineHash,
  );

  for (const path of new Set([...unmatched].map((candidate) => candidate.notePath))) {
    const currentAtPath = new Set(
      [...unmatched].filter((candidate) => candidate.notePath === path),
    );
    const previousAtPath = previous.filter((entry) => entry.notePath === path);
    matchCandidates(currentAtPath, previousAtPath, (candidate, entry) =>
      candidate.titleHash === entry.titleHash,
    );
    matchCandidates(currentAtPath, previousAtPath, (candidate, entry) =>
      candidate.lineNumber === entry.lineNumber,
    );
    for (const candidate of [...unmatched]) {
      if (candidate.notePath === path && !currentAtPath.has(candidate)) {
        unmatched.delete(candidate);
      }
    }
  }

  return [...unmatched];
}

function excludeDeferredFutureTasks(
  candidates: readonly StableIdCandidate[],
  previousIndex: Record<string, FutureTaskIndexEntry[]>,
  deferredFingerprints: ReadonlySet<string>,
  shouldDefer: (candidate: StableIdCandidate) => boolean,
): StableIdCandidate[] {
  const newCandidates = new Set(findNewFutureTasks(candidates, previousIndex));
  return candidates.filter(
    (candidate) =>
      !deferredFingerprints.has(candidateFingerprint(candidate)) &&
      !(newCandidates.has(candidate) && shouldDefer(candidate)),
  );
}

function matchCandidates(
  current: Set<StableIdCandidate>,
  previous: FutureTaskIndexEntry[],
  predicate: (
    candidate: StableIdCandidate,
    entry: FutureTaskIndexEntry,
  ) => boolean,
): void {
  for (const candidate of [...current]) {
    const matchIndex = previous.findIndex((entry) => predicate(candidate, entry));
    if (matchIndex !== -1) {
      current.delete(candidate);
      previous.splice(matchIndex, 1);
    }
  }
}

function isMarkdownFile(file: unknown): file is TFile {
  return Boolean(
    file &&
      typeof file === "object" &&
      "path" in file &&
      "extension" in file &&
      (file as { extension?: unknown }).extension === "md",
  );
}

function secureUuid(): string {
  if (typeof activeWindow.crypto?.randomUUID !== "function") {
    throw new Error("Secure random UUID generation is unavailable.");
  }
  return activeWindow.crypto.randomUUID();
}

function secureStableIdSuffix(): string {
  if (typeof activeWindow.crypto?.getRandomValues !== "function") {
    throw new Error("Secure random ID generation is unavailable.");
  }
  let suffix = "";
  const unbiasedLimit =
    Math.floor(256 / STABLE_ID_ALPHABET.length) * STABLE_ID_ALPHABET.length;
  while (suffix.length < STABLE_ID_SUFFIX_LENGTH) {
    const bytes = new Uint8Array(STABLE_ID_SUFFIX_LENGTH);
    activeWindow.crypto.getRandomValues(bytes);
    for (const value of bytes) {
      if (value >= unbiasedLimit) {
        continue;
      }
      suffix += STABLE_ID_ALPHABET[value % STABLE_ID_ALPHABET.length] ?? "0";
      if (suffix.length === STABLE_ID_SUFFIX_LENGTH) {
        break;
      }
    }
  }
  return suffix;
}

function isDainvoOwnedBlockId(blockId: string | null): boolean {
  return Boolean(
    blockId && (blockId.startsWith("dainvo-") || blockId.startsWith("d-")),
  );
}

function candidateFingerprint(candidate: StableIdCandidate): string {
  return `${candidate.notePath}\u0000${candidate.lineNumber}\u0000${candidate.lineHash}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
