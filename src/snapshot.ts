import type { Vault } from "obsidian";

import { buildProviderTaskId, parseMarkdownTasks } from "./parser";
import type {
  DailyNoteSettings,
  DainvoPluginSettings,
  ItemNoteSettings,
  ObsidianSnapshotPayload,
  ProjectNoteSettings,
} from "./types";

export async function buildSnapshotPayload(input: {
  vault: Vault;
  pluginVersion: string;
  settings: DainvoPluginSettings;
  dailyNoteSettings: DailyNoteSettings;
  itemNoteSettings: ItemNoteSettings;
  projectNoteSettings: ProjectNoteSettings;
}): Promise<ObsidianSnapshotPayload> {
  const tasks: ObsidianSnapshotPayload["tasks"] = [];
  const markdownFiles = input.vault
    .getMarkdownFiles()
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const file of markdownFiles) {
    const content = await input.vault.cachedRead(file);
    const parsedTasks = parseMarkdownTasks({
        vaultId: input.settings.vaultId,
        vaultName: input.settings.vaultName,
        notePath: file.path,
        content,
      });

    for (const task of parsedTasks) {
      const alias = task.blockId
        ? input.settings.identityAliases[task.blockId]
        : undefined;
      tasks.push({
        ...task,
        ...(alias?.bridgePending
          ? {
              previousProviderTaskId: buildProviderTaskId({
                vaultId: input.settings.vaultId,
                notePath: alias.notePath,
                lineNumber: alias.lineNumber,
                blockId: null,
              }),
            }
          : {}),
      });
    }
  }

  return {
    schemaVersion: 2,
    pluginVersion: input.pluginVersion,
    vaultId: input.settings.vaultId,
    vaultName: input.settings.vaultName,
    vaultPath: input.settings.vaultPath,
    vaultConfigDir: input.settings.vaultConfigDir,
    dailyNoteSettings: input.dailyNoteSettings,
    itemNoteSettings: input.itemNoteSettings,
    projectNoteSettings: input.projectNoteSettings,
    exportedAt: new Date().toISOString(),
    writeCapabilities: ["cross_note_hierarchy_move_v1"],
    tasks,
  };
}
