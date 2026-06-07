import { Notice, PluginSettingTab, Setting } from 'obsidian';

import type DainvoTaskManagerPlugin from './main';

export class DainvoTaskManagerSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: DainvoTaskManagerPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Dainvo Task Manager' });
    containerEl.createEl('p', {
      cls: 'dainvo-task-manager-status',
      text: `Status: ${this.plugin.settings.lastStatus}`
    });

    new Setting(containerEl)
      .setName('Dainvo bridge URL')
      .setDesc('Use the URL shown by Dainvo when starting Obsidian pairing.')
      .addText((text) =>
        text
          .setPlaceholder('http://127.0.0.1:12345')
          .setValue(this.plugin.settings.bridgeBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.bridgeBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Pairing code')
      .setDesc('Short-lived code shown by Dainvo.')
      .addText((text) =>
        text
          .setPlaceholder('000000')
          .setValue(this.plugin.settings.pairingCode)
          .onChange(async (value) => {
            this.plugin.settings.pairingCode = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Pair with Dainvo')
      .setDesc('Stores a vault-specific bearer token after Dainvo accepts the code.')
      .addButton((button) =>
        button
          .setButtonText('Pair')
          .setCta()
          .onClick(async () => {
            try {
              await this.plugin.pairWithDainvo();
              new Notice('Dainvo pairing complete.');
              this.display();
            } catch (error) {
              new Notice(formatError(error));
            }
          })
      );

    new Setting(containerEl)
      .setName('Sync now')
      .setDesc('Pushes a complete task snapshot for this vault.')
      .addButton((button) =>
        button.setButtonText('Sync').onClick(async () => {
          try {
            await this.plugin.pushSnapshotNow();
            new Notice('Dainvo snapshot sent.');
            this.display();
          } catch (error) {
            new Notice(formatError(error));
          }
        })
      );

    new Setting(containerEl)
      .setName('Poll write-back')
      .setDesc('Pulls pending Dainvo edits and applies them to existing task lines.')
      .addButton((button) =>
        button.setButtonText('Poll').onClick(async () => {
          try {
            await this.plugin.pollPendingOperations();
            new Notice('Dainvo write-back poll finished.');
            this.display();
          } catch (error) {
            new Notice(formatError(error));
          }
        })
      );

    if (this.plugin.settings.lastSnapshotAt) {
      containerEl.createEl('p', {
        cls: 'dainvo-task-manager-status',
        text: `Last snapshot: ${this.plugin.settings.lastSnapshotAt}`
      });
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

