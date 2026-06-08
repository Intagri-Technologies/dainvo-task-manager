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

    containerEl.createEl('h3', { text: 'Daily Notes task creation' });
    const overrideEnabled =
      this.plugin.settings.dailyNoteSettingsOverrideEnabled;
    const dailyNoteStatusEl = containerEl.createEl('p', {
      cls: 'dainvo-task-manager-status',
      text: 'Daily Notes settings: loading...'
    });
    void this.plugin
      .resolveDailyNoteSettings()
      .then((settings) => {
        dailyNoteStatusEl.setText(
          `Daily Notes settings: ${overrideEnabled ? 'override' : 'Obsidian'} | format ${settings.dateFormat} | folder ${settings.folder || '(vault root)'} | template ${settings.templatePath ?? '(none)'} | create ${settings.createEnabled ? 'enabled' : 'disabled'}`
        );
      })
      .catch((error) => {
        dailyNoteStatusEl.setText(`Daily Notes settings: ${formatError(error)}`);
      });

    new Setting(containerEl)
      .setName('Enable Daily Notes task creation')
      .setDesc('Allows Dainvo to create tasks in today\'s daily note.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.dailyNoteCreateEnabled)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteCreateEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Override Obsidian Daily Notes settings')
      .setDesc(
        'Off uses the active Obsidian Daily Notes or Periodic Notes daily settings automatically.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.dailyNoteSettingsOverrideEnabled)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteSettingsOverrideEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName('Copy current Obsidian settings')
      .setDesc(
        'Copies the detected Daily Notes format, folder, and template into the override fields.'
      )
      .addButton((button) =>
        button.setButtonText('Copy').onClick(async () => {
          try {
            await this.plugin.copyCurrentDailyNoteSettingsToOverrides();
            new Notice('Daily Notes settings copied into overrides.');
            this.display();
          } catch (error) {
            new Notice(formatError(error));
          }
        })
      );

    new Setting(containerEl)
      .setName('Date format')
      .setDesc('Override date format. Leave override off to use Obsidian.')
      .addText((text) =>
        text
          .setPlaceholder('YYYY-MM-DD')
          .setDisabled(!overrideEnabled)
          .setValue(this.plugin.settings.dailyNoteDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteDateFormat = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Folder')
      .setDesc('Override vault-relative daily notes folder.')
      .addText((text) =>
        text
          .setPlaceholder('Daily')
          .setDisabled(!overrideEnabled)
          .setValue(this.plugin.settings.dailyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Template path')
      .setDesc('Override vault-relative template note path.')
      .addText((text) =>
        text
          .setPlaceholder('Templates/Daily.md')
          .setDisabled(!overrideEnabled)
          .setValue(this.plugin.settings.dailyNoteTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteTemplatePath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Section heading')
      .setDesc('Heading where Dainvo-created tasks are appended.')
      .addText((text) =>
        text
          .setPlaceholder('## Dainvo')
          .setValue(this.plugin.settings.dailyNoteSectionHeading)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteSectionHeading =
              value.trim() || '## Dainvo';
            await this.plugin.saveSettings();
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
