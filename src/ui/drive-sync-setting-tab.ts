import { PluginSettingTab, Setting, type App } from 'obsidian';

import type DriveSyncPlugin from '../../main';
import { syncPhaseLabel } from '../domain/sync-status';

export class DriveSyncSettingTab extends PluginSettingTab {
  private uploadProgressView: ProgressView | null = null;
  private downloadProgressView: ProgressView | null = null;
  private inventoryProgressView: ProgressView | null = null;

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
    this.uploadProgressView = null;
    this.downloadProgressView = null;
    this.inventoryProgressView = null;

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

    const accountSetting = new Setting(containerEl).setName('Conta Google');
    if (this.plugin.connectedGoogleEmail === null) {
      const oauthReady = this.plugin.settings.oauthWorkerUrl.length > 0;
      accountSetting
        .setDesc(
          oauthReady
            ? 'O login abre o Google no navegador e retorna ao Obsidian.'
            : 'O servidor OAuth ainda precisa ser publicado e configurado.',
        )
        .addButton((button) =>
          button
            .setButtonText('Entrar com o Google')
            .setDisabled(!oauthReady)
            .setCta()
            .onClick(async () => {
              await this.plugin.beginGoogleAuthorization();
            }),
        );
    } else {
      accountSetting
        .setDesc(`Conectado como ${this.plugin.connectedGoogleEmail}.`)
        .addButton((button) =>
          button.setButtonText('Desvincular aparelho').onClick(() => {
            this.plugin.disconnectGoogle();
          }),
        );

      new Setting(containerEl)
        .setName('Diagnóstico do Google Drive')
        .setDesc(
          this.plugin.driveDiagnosticMessage ??
            'Faz uma listagem somente leitura para confirmar a API e o escopo drive.file.',
        )
        .addButton((button) =>
          button
            .setButtonText(this.plugin.driveDiagnosticRunning ? 'Testando…' : 'Testar acesso')
            .setDisabled(this.plugin.driveDiagnosticRunning)
            .onClick(async () => {
              await this.plugin.testDriveAccess();
            }),
        );

      const remoteVaultSetting = new Setting(containerEl).setName('Cofre remoto');
      if (this.plugin.settings.remoteVaultId === null) {
        remoteVaultSetting
          .setDesc(
            this.plugin.remoteSetupMessage ??
              'Cria uma pasta vazia e protegida no Drive. Nenhum arquivo local será enviado nesta etapa.',
          )
          .addButton((button) =>
            button
              .setButtonText(this.plugin.remoteSetupRunning ? 'Criando…' : 'Criar cofre remoto')
              .setDisabled(this.plugin.remoteSetupRunning)
              .setCta()
              .onClick(async () => {
                await this.plugin.createRemoteVault();
              }),
          )
          .addButton((button) =>
            button
              .setButtonText(
                this.plugin.remoteDiscoveryRunning ? 'Procurando…' : 'Usar cofre existente',
              )
              .setDisabled(this.plugin.remoteDiscoveryRunning)
              .onClick(async () => {
                await this.plugin.discoverRemoteVaults();
              }),
          );

        if (this.plugin.remoteVaultCandidates.length > 0) {
          new Setting(containerEl)
            .setName('Cofres encontrados')
            .setDesc('A seleção apenas vincula este aparelho; nenhum arquivo é transferido ainda.')
            .addDropdown((dropdown) => {
              dropdown.addOption('', 'Selecione um cofre');
              for (const candidate of this.plugin.remoteVaultCandidates) {
                dropdown.addOption(
                  candidate.rootId,
                  candidate.createdTime === null
                    ? candidate.name
                    : `${candidate.name} · ${formatDate(candidate.createdTime)}`,
                );
              }
              return dropdown.onChange(async (value) => {
                if (value.length > 0) await this.plugin.selectRemoteVault(value);
              });
            });
        }
      } else {
        remoteVaultSetting
          .setDesc(
            this.plugin.remoteSetupMessage ??
              `Este vault envia e baixa somente da pasta remota: ${this.plugin.settings.remoteVaultName ?? `ID ${this.plugin.settings.remoteVaultId}`}.`,
          )
          .addButton((button) =>
            button
              .setButtonText(
                this.plugin.remoteSetupRunning ? 'Verificando…' : 'Verificar estrutura',
              )
              .setDisabled(this.plugin.remoteSetupRunning)
              .onClick(async () => {
                await this.plugin.ensureRemoteVaultStructure();
              }),
          )
          .addButton((button) =>
            button.setButtonText('Trocar pasta remota').onClick(async () => {
              await this.plugin.unlinkRemoteVault();
            }),
          );

        new Setting(containerEl)
          .setName('Teste de arquivo grande')
          .setDesc(
            this.plugin.largeUploadDiagnosticMessage ??
              'Envia 18 MB de dados artificiais pelo transporte nativo, confere a integridade e move o teste para a lixeira do Drive.',
          )
          .addButton((button) =>
            button
              .setButtonText(
                this.plugin.largeUploadDiagnosticRunning ? 'Testando…' : 'Testar 18 MB',
              )
              .setDisabled(this.plugin.largeUploadDiagnosticRunning)
              .onClick(async () => {
                await this.plugin.testLargeUpload();
              }),
          );

        new Setting(containerEl)
          .setName('Modo da primeira sincronização')
          .setDesc(initialSyncModeDescription(this.plugin.settings.initialSyncMode))
          .addDropdown((dropdown) =>
            dropdown
              .addOptions({
                '': 'Selecione uma opção',
                'upload-local': 'Enviar este cofre ao Drive',
                'download-remote': 'Baixar o cofre do Drive',
                merge: 'Combinar local e remoto',
              })
              .setValue(this.plugin.settings.initialSyncMode ?? '')
              .onChange(async (value) => {
                await this.plugin.selectInitialSyncMode(value);
              }),
          );

        if (this.plugin.settings.initialSyncMode === 'upload-local') {
          const completedAt = this.plugin.settings.initialSyncCompletedAt;
          new Setting(containerEl)
            .setName('Primeiro envio')
            .setDesc(
              completedAt === null
                ? initialUploadDescription(this.plugin)
                : `Concluído em ${formatDate(completedAt)}.`,
            )
            .addButton((button) =>
              button
                .setButtonText(
                  completedAt === null
                    ? this.plugin.initialUploadRunning
                      ? 'Enviando…'
                      : 'Enviar agora'
                    : 'Concluído',
                )
                .setDisabled(this.plugin.initialUploadRunning || completedAt !== null)
                .setCta()
                .onClick(async () => {
                  await this.plugin.runInitialUpload();
                }),
            );
          if (this.plugin.initialUploadRunning) {
            this.uploadProgressView = createProgressView(containerEl);
            this.updateUploadProgress();
          }
        }
        if (this.plugin.settings.initialSyncMode === 'download-remote') {
          const completedAt = this.plugin.settings.initialSyncCompletedAt;
          new Setting(containerEl)
            .setName('Primeiro download')
            .setDesc(
              completedAt === null
                ? initialDownloadDescription(this.plugin)
                : `Concluído em ${formatDate(completedAt)}.`,
            )
            .addButton((button) =>
              button
                .setButtonText(
                  completedAt === null
                    ? this.plugin.initialDownloadRunning
                      ? 'Baixando…'
                      : 'Baixar agora'
                    : 'Concluído',
                )
                .setDisabled(this.plugin.initialDownloadRunning || completedAt !== null)
                .setCta()
                .onClick(async () => {
                  await this.plugin.runInitialDownload();
                }),
            );
          if (this.plugin.initialDownloadRunning) {
            this.downloadProgressView = createProgressView(containerEl);
            this.updateDownloadProgress();
          }
        }
      }
    }

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

    new Setting(containerEl).setName('Inventário local').setHeading();
    const latestInventory = this.plugin.inventoryState.latest;
    if (latestInventory === null) {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'O cofre ainda não foi analisado. A análise apenas lê arquivos e calcula hashes locais.',
      });
    } else {
      const summary = latestInventory.summary;
      const inventoryCard = containerEl.createDiv({ cls: 'drive-sync-inventory-card' });
      inventoryCard.createEl('strong', {
        text: `${summary.fileCount} arquivos · ${formatBytes(summary.totalBytes)}`,
      });
      inventoryCard.createEl('div', {
        text: `Analisado em ${formatDate(summary.scannedAt)} · Ignorados: ${summary.ignoredCount} · Falhas: ${summary.failedCount}`,
      });
      if (latestInventory.failures.length > 0) {
        const failureList = inventoryCard.createEl('ul');
        latestInventory.failures.slice(0, 5).forEach((failure) => {
          failureList.createEl('li', { text: `${failure.path}: ${failure.message}` });
        });
      }
    }

    new Setting(containerEl)
      .setName('Analisar cofre')
      .setDesc(
        this.plugin.inventoryRunning
          ? formatProgress(this.plugin.inventoryProgress)
          : 'Lê texto e binários sequencialmente, sem modificar nenhum arquivo.',
      )
      .addButton((button) =>
        button
          .setButtonText(this.plugin.inventoryRunning ? 'Analisando…' : 'Analisar agora')
          .setDisabled(this.plugin.inventoryRunning)
          .onClick(async () => {
            await this.plugin.analyzeVault();
          }),
      );

    if (this.plugin.inventoryRunning) {
      this.inventoryProgressView = createProgressView(containerEl);
      this.updateInventoryProgress();
    }

    if (this.plugin.inventoryState.history.length > 0) {
      containerEl.createEl('h4', { text: 'Histórico de análises' });
      const historyList = containerEl.createEl('ul', { cls: 'drive-sync-history-list' });
      this.plugin.inventoryState.history.slice(0, 5).forEach((summary) => {
        historyList.createEl('li', {
          text: `${formatDate(summary.scannedAt)} — ${summary.fileCount} arquivos, ${formatBytes(summary.totalBytes)}, ${summary.failedCount} falhas`,
        });
      });
    }

    new Setting(containerEl)
      .setName('Sincronização manual')
      .setDesc('A sincronização incremental será habilitada após validar o primeiro download.')
      .addButton((button) =>
        button
          .setButtonText('Sincronizar agora')
          .setCta()
          .onClick(() => {
            this.plugin.requestSync();
          }),
      );
  }

  refreshProgress(): void {
    this.updateUploadProgress();
    this.updateDownloadProgress();
    this.updateInventoryProgress();
  }

  private updateUploadProgress(): void {
    const progress = this.plugin.initialUploadProgress;
    if (this.uploadProgressView === null || progress === null) return;
    updateProgressView(
      this.uploadProgressView,
      progress.completedFiles,
      progress.totalFiles,
      'Preparando e enviando',
      progress.currentPath,
    );
  }

  private updateDownloadProgress(): void {
    const progress = this.plugin.initialDownloadProgress;
    if (this.downloadProgressView === null || progress === null) return;
    const phase = {
      checking: 'Verificando',
      downloading: 'Baixando',
      applying: 'Aplicando',
    }[progress.phase];
    updateProgressView(
      this.downloadProgressView,
      progress.completedFiles,
      progress.totalFiles,
      phase,
      progress.currentPath,
    );
  }

  private updateInventoryProgress(): void {
    const progress = this.plugin.inventoryProgress;
    if (this.inventoryProgressView === null || progress === null) return;
    updateProgressView(
      this.inventoryProgressView,
      progress.processedFiles,
      progress.discoveredFiles,
      'Analisando',
      progress.currentPath ?? 'Descobrindo arquivos',
    );
  }
}

interface ProgressView {
  readonly bar: HTMLProgressElement;
  readonly summary: HTMLElement;
  readonly currentPath: HTMLElement;
}

function createProgressView(containerEl: HTMLElement): ProgressView {
  const panel = containerEl.createDiv({ cls: 'drive-sync-progress' });
  const summary = panel.createDiv({ cls: 'drive-sync-progress__summary' });
  const bar = panel.createEl('progress', {
    cls: 'drive-sync-progress__bar',
    attr: { max: '1', 'aria-label': 'Progresso da sincronização' },
  });
  const currentPath = panel.createDiv({ cls: 'drive-sync-progress__path' });
  return { bar, summary, currentPath };
}

function updateProgressView(
  view: ProgressView,
  completed: number,
  total: number,
  action: string,
  currentPath: string,
): void {
  if (total <= 0) {
    view.bar.removeAttribute('value');
    view.summary.setText(`${action}…`);
  } else {
    const safeCompleted = Math.min(Math.max(completed, 0), total);
    const percent = Math.round((safeCompleted / total) * 100);
    view.bar.max = total;
    view.bar.value = safeCompleted;
    view.summary.setText(`${action}: ${safeCompleted} de ${total} · ${percent}%`);
  }
  view.currentPath.setText(currentPath);
}

function initialDownloadDescription(plugin: DriveSyncPlugin): string {
  const progress = plugin.initialDownloadProgress;
  if (progress !== null) {
    const phase = {
      checking: 'Verificando',
      downloading: 'Baixando',
      applying: 'Aplicando',
    }[progress.phase];
    return `${phase}: ${progress.completedFiles} de ${progress.totalFiles} · ${progress.currentPath}`;
  }
  return 'Verifica manifesto e hashes antes de escrever. Notas locais diferentes não serão sobrescritas; configurações existentes recebem cópia de segurança.';
}

function initialUploadDescription(plugin: DriveSyncPlugin): string {
  const progress = plugin.initialUploadProgress;
  if (progress !== null) {
    return `${progress.completedFiles} de ${progress.totalFiles} arquivos · ${progress.currentPath}`;
  }
  const summary = plugin.inventoryState.latest?.summary;
  return summary === undefined
    ? 'Reanalisa o cofre e envia até três arquivos simultaneamente. Pode ser retomado após uma falha.'
    : `Reanalisa e prepara ${summary.fileCount} arquivos (${formatBytes(summary.totalBytes)}). O manifesto só é confirmado ao final.`;
}

function initialSyncModeDescription(mode: DriveSyncPlugin['settings']['initialSyncMode']): string {
  if (mode === 'upload-local') {
    return 'Recomendado para este cofre remoto novo: prepara o envio dos arquivos locais sem apagar nada no Drive.';
  }
  if (mode === 'download-remote') {
    return 'Destinado a um aparelho novo. Antes de escrever localmente, diferenças serão revisadas.';
  }
  if (mode === 'merge') {
    return 'Preserva as duas versões quando não for possível decidir com segurança.';
  }
  return 'Escolha explicitamente como o conteúdo inicial deve ser tratado. Nenhuma transferência começa apenas ao selecionar.';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('pt-BR');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatProgress(progress: DriveSyncPlugin['inventoryProgress']): string {
  if (progress === null || progress.discoveredFiles === 0) {
    return 'Descobrindo arquivos…';
  }

  return `${progress.processedFiles} de ${progress.discoveredFiles} arquivos processados.`;
}
