import { PluginSettingTab, Setting, type App } from 'obsidian';

import type DriveSyncPlugin from '../../main';
import { syncPhaseLabel } from '../domain/sync-status';

export class DriveSyncSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: DriveSyncPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const status = this.plugin.syncStatus.get();
    containerEl.empty();
    containerEl.addClass('drive-sync-settings');

    new Setting(containerEl).setName('Obsidian Drive Sync').setHeading();

    const statusCard = containerEl.createDiv({ cls: 'drive-sync-status-card' });
    statusCard.createDiv({
      cls: `drive-sync-status drive-sync-status--${status.phase}`,
      text: syncPhaseLabel(status.phase),
    });
    statusCard.createEl('p', { text: status.message });
    statusCard.createEl('small', {
      text: `Última sincronização: ${status.lastSyncAt ?? 'nunca'} · Enviados: ${status.counters.uploaded} · Baixados: ${status.counters.downloaded}`,
    });

    new Setting(containerEl)
      .setName('Conta Google')
      .setDesc('A autenticação será adicionada após a aprovação da estratégia OAuth.')
      .addButton((button) =>
        button.setButtonText('Entrar com o Google').setDisabled(true).setCta(),
      );

    new Setting(containerEl)
      .setName('Nome deste aparelho')
      .setDesc('Será usado no histórico e nos nomes de cópias de conflito.')
      .addText((text) =>
        text.setValue(this.plugin.settings.deviceName).onChange(async (value) => {
          this.plugin.settings.deviceName = value.trim() || 'Este aparelho';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Intervalo automático')
      .setDesc('A execução automática será habilitada em uma fase posterior.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            '5': '5 minutos',
            '15': '15 minutos',
            '30': '30 minutos',
            '60': '1 hora',
          })
          .setValue(String(this.plugin.settings.automaticSyncIntervalMinutes))
          .onChange(async (value) => {
            this.plugin.settings.automaticSyncIntervalMinutes = Number(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('Itens ignorados').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Um caminho ou padrão por linha. A lista inicial protege estados locais e dados internos do plugin.',
    });
    const ignoredPaths = containerEl.createEl('textarea', {
      cls: 'drive-sync-ignored-paths',
      attr: { 'aria-label': 'Arquivos e pastas ignorados' },
    });
    ignoredPaths.value = this.plugin.settings.ignoredPaths.join('\n');
    ignoredPaths.addEventListener('change', () => {
      this.plugin.settings.ignoredPaths = ignoredPaths.value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      void this.plugin.saveSettings();
    });

    new Setting(containerEl)
      .setName('Sincronização manual')
      .setDesc('Ainda não altera o cofre nem acessa a rede nesta fase.')
      .addButton((button) =>
        button
          .setButtonText('Sincronizar agora')
          .setCta()
          .onClick(() => {
            this.plugin.requestSync();
          }),
      );
  }
}
