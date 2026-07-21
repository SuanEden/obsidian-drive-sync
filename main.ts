import { Notice, Plugin } from 'obsidian';

import { syncPhaseLabel } from './src/domain/sync-status';
import {
  DEFAULT_SETTINGS,
  createDefaultSettings,
  parseSettings,
  type DriveSyncSettings,
} from './src/settings/plugin-settings';
import { SyncStatusStore } from './src/services/sync-status-store';
import { DriveSyncSettingTab } from './src/ui/drive-sync-setting-tab';

export default class DriveSyncPlugin extends Plugin {
  override settings: DriveSyncSettings = { ...DEFAULT_SETTINGS };
  readonly syncStatus = new SyncStatusStore();

  override async onload(): Promise<void> {
    await this.loadSettings();

    const statusBar = this.addStatusBarItem();
    statusBar.addClass('drive-sync-status-bar');
    this.register(() =>
      this.syncStatus.subscribe((status) => {
        statusBar.setText(`Drive Sync: ${syncPhaseLabel(status.phase)}`);
        statusBar.setAttr('aria-label', status.message);
      }),
    );

    this.addRibbonIcon('refresh-cw', 'Sincronizar agora', () => this.requestSync());
    this.addCommand({
      id: 'sync-now',
      name: 'Sincronizar agora',
      callback: () => this.requestSync(),
    });
    this.addSettingTab(new DriveSyncSettingTab(this.app, this));
  }

  requestSync(): void {
    new Notice(
      'A sincronização remota ainda não está ativa. Configure a base e aguarde a fase de OAuth.',
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    const defaults = createDefaultSettings(this.app.vault.configDir, this.manifest.id);
    this.settings = parseSettings(await this.loadData(), defaults);
  }
}
