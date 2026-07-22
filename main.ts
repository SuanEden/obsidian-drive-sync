import { Notice, Plugin, type ObsidianProtocolData } from 'obsidian';

import { syncPhaseLabel } from './src/domain/sync-status';
import {
  EMPTY_INVENTORY_STATE,
  type InventoryProgress,
  type InventoryState,
} from './src/domain/inventory';
import { VaultInventoryService } from './src/services/vault-inventory-service';
import { isCurrentPluginData, parsePluginData, recordInventory } from './src/settings/plugin-data';
import {
  DEFAULT_SETTINGS,
  createDefaultSettings,
  type DriveSyncSettings,
} from './src/settings/plugin-settings';
import { SyncStatusStore } from './src/services/sync-status-store';
import { DriveSyncSettingTab } from './src/ui/drive-sync-setting-tab';
import { GoogleOAuthService } from './src/auth/google-oauth';
import { ObsidianOAuthRefreshRequester } from './src/auth/obsidian-oauth-refresh-requester';
import { DriveClient } from './src/drive/drive-client';
import { ObsidianHttpTransport } from './src/drive/obsidian-http-transport';
import {
  RemoteVaultStructureService,
  type RemoteVaultCandidate,
} from './src/drive/remote-vault-structure';
import {
  InitialUploadService,
  type InitialUploadProgress,
} from './src/sync/initial-upload-service';
import {
  InitialDownloadService,
  type InitialDownloadProgress,
} from './src/sync/initial-download-service';
import { LargeUploadDiagnosticService } from './src/sync/large-upload-diagnostic-service';

export default class DriveSyncPlugin extends Plugin {
  override settings: DriveSyncSettings = { ...DEFAULT_SETTINGS };
  readonly syncStatus = new SyncStatusStore();
  inventoryState: InventoryState = EMPTY_INVENTORY_STATE;
  inventoryProgress: InventoryProgress | null = null;
  inventoryRunning = false;
  connectedGoogleEmail: string | null = null;
  driveDiagnosticRunning = false;
  driveDiagnosticMessage: string | null = null;
  largeUploadDiagnosticRunning = false;
  largeUploadDiagnosticMessage: string | null = null;
  remoteSetupRunning = false;
  remoteSetupMessage: string | null = null;
  remoteVaultCandidates: readonly RemoteVaultCandidate[] = [];
  remoteDiscoveryRunning = false;
  initialUploadRunning = false;
  initialUploadProgress: InitialUploadProgress | null = null;
  initialDownloadRunning = false;
  initialDownloadProgress: InitialDownloadProgress | null = null;
  private settingTab: DriveSyncSettingTab | null = null;
  private googleOAuth: GoogleOAuthService | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.googleOAuth = new GoogleOAuthService(
      this.app.secretStorage,
      (url) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
      new ObsidianOAuthRefreshRequester(),
    );
    this.connectedGoogleEmail = this.googleOAuth.getTokens()?.email ?? null;
    if (this.connectedGoogleEmail !== null) {
      this.syncStatus.set({
        ...this.syncStatus.get(),
        message:
          this.settings.remoteVaultId === null
            ? 'Conta Google conectada. Teste o Drive e escolha um cofre remoto.'
            : this.settings.initialSyncMode === null
              ? 'Cofre remoto criado. Falta escolher o modo da primeira sincronização.'
              : initialSyncModeMessage(this.settings.initialSyncMode),
      });
    }
    this.registerObsidianProtocolHandler('drive-sync-auth', (data) => {
      void this.finishGoogleAuthorization(data);
    });

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
    this.addCommand({
      id: 'analyze-vault',
      name: 'Analisar cofre (somente leitura)',
      callback: () => {
        void this.analyzeVault();
      },
    });
    this.settingTab = new DriveSyncSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  requestSync(): void {
    if (this.connectedGoogleEmail === null) {
      new Notice('Conecte sua conta Google antes de sincronizar.');
      return;
    }
    new Notice(
      'A conta está conectada. A transferência de arquivos será ativada após o diagnóstico do Drive.',
    );
  }

  async beginGoogleAuthorization(): Promise<void> {
    if (this.googleOAuth === null) return;
    try {
      await this.googleOAuth.beginAuthorization(this.settings.oauthWorkerUrl);
      new Notice('Conclua a autorização no navegador e retorne ao Obsidian.');
    } catch (error) {
      new Notice(`Não foi possível iniciar o acesso ao Google: ${errorMessage(error)}`);
    }
  }

  disconnectGoogle(): void {
    this.googleOAuth?.disconnect();
    this.connectedGoogleEmail = null;
    this.driveDiagnosticMessage = null;
    this.syncStatus.set({
      ...this.syncStatus.get(),
      phase: 'not-configured',
      message: 'Conecte uma conta e escolha um cofre remoto para começar.',
    });
    this.settingTab?.display();
    new Notice('Este aparelho foi desvinculado. O cofre remoto não foi apagado.');
  }

  async testDriveAccess(): Promise<void> {
    if (this.driveDiagnosticRunning || this.googleOAuth === null) return;
    const tokens = this.googleOAuth.getTokens();
    if (tokens === null) {
      new Notice('Conecte novamente a conta Google antes de testar o Drive.');
      return;
    }

    this.driveDiagnosticRunning = true;
    this.driveDiagnosticMessage = 'Testando acesso somente leitura…';
    this.settingTab?.display();
    try {
      const drive = this.createDriveClient();
      const visibleItems = await drive.listChildren('root');
      this.driveDiagnosticMessage = `Acesso confirmado. ${visibleItems.length} item(ns) criado(s) ou autorizado(s) para este aplicativo na raiz do Drive.`;
      this.syncStatus.set({
        ...this.syncStatus.get(),
        message:
          this.settings.remoteVaultId === null
            ? 'Drive acessível. Falta criar ou selecionar o cofre remoto.'
            : this.settings.initialSyncMode === null
              ? 'Drive acessível e cofre remoto vinculado. Escolha o modo da primeira sincronização.'
              : initialSyncModeMessage(this.settings.initialSyncMode),
      });
      new Notice('Acesso ao Google Drive confirmado.');
    } catch (error) {
      this.driveDiagnosticMessage = `Falha no diagnóstico: ${errorMessage(error)}`;
      new Notice(this.driveDiagnosticMessage);
    } finally {
      this.driveDiagnosticRunning = false;
      this.settingTab?.display();
    }
  }

  async createRemoteVault(): Promise<void> {
    if (this.remoteSetupRunning || this.googleOAuth === null) return;
    if (this.settings.remoteVaultId !== null) {
      new Notice('Este aparelho já está vinculado a um cofre remoto.');
      return;
    }
    const tokens = this.googleOAuth.getTokens();
    if (tokens === null) {
      new Notice('Conecte novamente antes de criar o cofre remoto.');
      return;
    }

    this.remoteSetupRunning = true;
    this.remoteSetupMessage = 'Criando a estrutura remota vazia…';
    this.settingTab?.display();
    try {
      const drive = this.createDriveClient();
      const markerId = createPortableId();
      const remoteVaultName = `Obsidian Drive Sync - ${this.app.vault.getName()}`;
      await RemoteVaultStructureService.fromDriveClient(drive).createRoot(
        remoteVaultName,
        markerId,
        async (rootId) => {
          this.settings.remoteVaultId = rootId;
          this.settings.remoteVaultMarkerId = markerId;
          this.settings.remoteVaultName = remoteVaultName;
          await this.saveSettings();
        },
      );
      this.remoteSetupMessage =
        'Cofre remoto criado com vault, backups, trash e sync-data. Nenhum arquivo local foi enviado.';
      this.syncStatus.set({
        ...this.syncStatus.get(),
        message: 'Cofre remoto criado. Falta escolher o modo da primeira sincronização.',
      });
      new Notice('Estrutura do cofre remoto criada no Google Drive.');
    } catch (error) {
      this.remoteSetupMessage = `Falha ao criar o cofre remoto: ${errorMessage(error)}`;
      new Notice(this.remoteSetupMessage);
    } finally {
      this.remoteSetupRunning = false;
      this.settingTab?.display();
    }
  }

  async discoverRemoteVaults(): Promise<void> {
    if (this.remoteDiscoveryRunning || this.googleOAuth === null) return;
    if (this.googleOAuth.getTokens() === null) {
      new Notice('Conecte novamente antes de procurar cofres remotos.');
      return;
    }
    this.remoteDiscoveryRunning = true;
    this.remoteSetupMessage = 'Procurando cofres criados pelo plugin…';
    this.settingTab?.display();
    try {
      const service = RemoteVaultStructureService.fromDriveClient(this.createDriveClient());
      this.remoteVaultCandidates = await service.discoverRoots();
      this.remoteSetupMessage =
        this.remoteVaultCandidates.length === 0
          ? 'Nenhum cofre criado pelo plugin foi encontrado nesta conta.'
          : `${this.remoteVaultCandidates.length} cofre(s) encontrado(s). Escolha um explicitamente.`;
    } catch (error) {
      this.remoteSetupMessage = `Falha ao procurar cofres: ${errorMessage(error)}`;
      new Notice(this.remoteSetupMessage);
    } finally {
      this.remoteDiscoveryRunning = false;
      this.settingTab?.display();
    }
  }

  async selectRemoteVault(rootId: string): Promise<void> {
    const candidate = this.remoteVaultCandidates.find((item) => item.rootId === rootId);
    if (candidate === undefined) return;
    this.settings.remoteVaultId = candidate.rootId;
    this.settings.remoteVaultMarkerId = candidate.vaultId;
    this.settings.remoteVaultName = candidate.name;
    this.settings.initialSyncMode = null;
    this.settings.initialSyncCompletedAt = null;
    await this.saveSettings();
    this.remoteSetupMessage = `Cofre remoto selecionado: ${candidate.name}.`;
    this.syncStatus.set({
      ...this.syncStatus.get(),
      message: 'Cofre remoto selecionado. Escolha o modo da primeira sincronização.',
    });
    this.settingTab?.display();
    new Notice(`Cofre remoto selecionado: ${candidate.name}`);
  }

  async unlinkRemoteVault(): Promise<void> {
    if (this.initialUploadRunning || this.initialDownloadRunning || this.remoteSetupRunning) {
      new Notice('Aguarde a operação atual terminar antes de trocar a pasta remota.');
      return;
    }
    const confirmed = window.confirm(
      'Trocar a pasta remota deste vault? Nenhum arquivo será apagado do Google Drive.',
    );
    if (!confirmed) return;

    this.settings.remoteVaultId = null;
    this.settings.remoteVaultMarkerId = null;
    this.settings.remoteVaultName = null;
    this.settings.initialSyncMode = null;
    this.settings.initialSyncCompletedAt = null;
    this.remoteVaultCandidates = [];
    this.remoteSetupMessage =
      'Escolha ou crie uma pasta remota para este vault. Nada foi apagado do Drive.';
    await this.saveSettings();
    this.syncStatus.set({
      ...this.syncStatus.get(),
      phase: 'not-configured',
      message: 'Escolha uma pasta remota para este vault.',
    });
    this.settingTab?.display();
    new Notice('Pasta remota desvinculada somente deste vault.');
  }

  async ensureRemoteVaultStructure(): Promise<void> {
    if (this.remoteSetupRunning || this.googleOAuth === null) return;
    const rootId = this.settings.remoteVaultId;
    const markerId = this.settings.remoteVaultMarkerId;
    const tokens = this.googleOAuth.getTokens();
    if (rootId === null || markerId === null) {
      new Notice('O vínculo remoto local está incompleto.');
      return;
    }
    if (tokens === null) {
      new Notice('Conecte novamente antes de verificar o cofre.');
      return;
    }

    this.remoteSetupRunning = true;
    this.remoteSetupMessage = 'Verificando e completando somente pastas ausentes…';
    this.settingTab?.display();
    try {
      const drive = this.createDriveClient();
      await RemoteVaultStructureService.fromDriveClient(drive).ensure(rootId, markerId);
      this.remoteSetupMessage =
        'Estrutura confirmada: vault, backups, trash e sync-data estão disponíveis.';
      new Notice('Estrutura remota verificada com sucesso.');
    } catch (error) {
      this.remoteSetupMessage = `Falha ao verificar o cofre remoto: ${errorMessage(error)}`;
      new Notice(this.remoteSetupMessage);
    } finally {
      this.remoteSetupRunning = false;
      this.settingTab?.display();
    }
  }

  async testLargeUpload(): Promise<void> {
    if (this.largeUploadDiagnosticRunning || this.googleOAuth === null) return;
    const rootId = this.settings.remoteVaultId;
    const markerId = this.settings.remoteVaultMarkerId;
    if (rootId === null || markerId === null || this.googleOAuth.getTokens() === null) {
      new Notice('Conecte a conta e selecione um cofre remoto antes do teste.');
      return;
    }
    this.largeUploadDiagnosticRunning = true;
    this.largeUploadDiagnosticMessage = 'Preparando arquivo artificial de 18 MB…';
    this.settingTab?.display();
    try {
      const drive = this.createDriveClient();
      const structure = await RemoteVaultStructureService.fromDriveClient(drive).ensure(
        rootId,
        markerId,
      );
      await new LargeUploadDiagnosticService(drive).run({
        parentId: structure.syncDataFolderId,
        vaultId: markerId,
        onProgress: (uploaded, total) => {
          this.largeUploadDiagnosticMessage = `Enviando arquivo artificial: ${formatPercent(uploaded, total)}%.`;
          this.settingTab?.display();
        },
      });
      this.largeUploadDiagnosticMessage =
        'Arquivo de 18 MB enviado, baixado e verificado. A cópia de teste foi movida para a lixeira do Drive.';
      new Notice('Teste de arquivo grande concluído com sucesso.');
    } catch (error) {
      this.largeUploadDiagnosticMessage = `Falha no teste de arquivo grande: ${errorMessage(error)}`;
      new Notice(this.largeUploadDiagnosticMessage, 10_000);
    } finally {
      this.largeUploadDiagnosticRunning = false;
      this.settingTab?.display();
    }
  }

  async selectInitialSyncMode(value: string): Promise<void> {
    if (value !== 'upload-local' && value !== 'download-remote' && value !== 'merge') return;
    this.settings.initialSyncMode = value;
    await this.saveSettings();
    this.syncStatus.set({
      ...this.syncStatus.get(),
      message: initialSyncModeMessage(value),
    });
    this.settingTab?.display();
  }

  async runInitialUpload(): Promise<void> {
    if (this.initialUploadRunning || this.googleOAuth === null) return;
    if (this.settings.initialSyncMode !== 'upload-local') {
      new Notice('Selecione “Enviar este cofre ao Drive” antes do primeiro envio.');
      return;
    }
    if (this.settings.initialSyncCompletedAt !== null) {
      new Notice('O primeiro envio já foi concluído neste aparelho.');
      return;
    }
    const rootId = this.settings.remoteVaultId;
    const markerId = this.settings.remoteVaultMarkerId;
    const tokens = this.googleOAuth.getTokens();
    if (rootId === null || markerId === null || tokens === null) {
      new Notice('A conta ou o cofre remoto não está configurado completamente.');
      return;
    }

    this.initialUploadRunning = true;
    this.initialUploadProgress = {
      completedFiles: 0,
      totalFiles: 0,
      currentPath: 'Inventário local',
    };
    this.syncStatus.set({
      ...this.syncStatus.get(),
      phase: 'syncing',
      message: 'Reanalisando o cofre antes do primeiro envio…',
    });
    this.settingTab?.display();
    try {
      const snapshot = await new VaultInventoryService(this.app.vault.adapter).scan({
        ignoredPaths: this.settings.ignoredPaths,
        onProgress: (progress) => {
          this.initialUploadProgress = {
            completedFiles: progress.processedFiles,
            totalFiles: progress.discoveredFiles,
            currentPath: progress.currentPath ?? 'Inventário local',
          };
          this.settingTab?.refreshProgress();
        },
      });
      this.inventoryState = recordInventory(this.inventoryState, snapshot);
      await this.savePluginData();

      const drive = this.createDriveClient();
      const structure = await RemoteVaultStructureService.fromDriveClient(drive).ensure(
        rootId,
        markerId,
      );
      const result = await new InitialUploadService(this.app.vault.adapter, drive).upload({
        snapshot,
        structure,
        vaultId: markerId,
        deviceId: this.settings.deviceName,
        onProgress: (progress) => {
          this.initialUploadProgress = progress;
          this.syncStatus.set({
            ...this.syncStatus.get(),
            phase: 'syncing',
            message: `Primeiro envio: ${progress.completedFiles} de ${progress.totalFiles} arquivos.`,
          });
          this.settingTab?.refreshProgress();
        },
      });
      this.settings.initialSyncCompletedAt = result.completedAt;
      await this.savePluginData();
      this.syncStatus.set({
        phase: 'up-to-date',
        lastSyncAt: result.completedAt,
        counters: { uploaded: result.uploadedFiles, downloaded: 0 },
        message: 'Primeiro envio concluído e manifesto remoto confirmado.',
      });
      new Notice(`Primeiro envio concluído: ${result.uploadedFiles} arquivos.`);
    } catch (error) {
      this.syncStatus.set({
        ...this.syncStatus.get(),
        phase: 'error',
        message: `Primeiro envio interrompido: ${errorMessage(error)}`,
      });
      new Notice(`Primeiro envio interrompido: ${errorMessage(error)}`);
    } finally {
      this.initialUploadRunning = false;
      this.initialUploadProgress = null;
      this.settingTab?.display();
    }
  }

  async runInitialDownload(): Promise<void> {
    if (this.initialDownloadRunning || this.googleOAuth === null) return;
    if (this.settings.initialSyncMode !== 'download-remote') {
      new Notice('Selecione “Baixar o cofre do Drive” antes do primeiro download.');
      return;
    }
    if (this.settings.initialSyncCompletedAt !== null) {
      new Notice('A primeira sincronização já foi concluída neste aparelho.');
      return;
    }
    const rootId = this.settings.remoteVaultId;
    const markerId = this.settings.remoteVaultMarkerId;
    if (rootId === null || markerId === null || this.googleOAuth.getTokens() === null) {
      new Notice('A conta ou o cofre remoto não está configurado completamente.');
      return;
    }

    this.initialDownloadRunning = true;
    this.initialDownloadProgress = {
      completedFiles: 0,
      totalFiles: 0,
      currentPath: 'Manifesto remoto',
      phase: 'checking',
    };
    this.syncStatus.set({
      ...this.syncStatus.get(),
      phase: 'syncing',
      message: 'Verificando o cofre remoto antes do primeiro download…',
    });
    this.settingTab?.display();
    try {
      const drive = this.createDriveClient();
      const structure = await RemoteVaultStructureService.fromDriveClient(drive).ensure(
        rootId,
        markerId,
      );
      const pluginDataRoot = `${this.app.vault.configDir}/plugins/${this.manifest.id}/sync-data`;
      const operationId = new Date().toISOString().replace(/[:.]/gu, '-');
      const result = await new InitialDownloadService(this.app.vault.adapter, drive).download({
        structure,
        vaultId: markerId,
        ignoredPaths: this.settings.ignoredPaths,
        stagingRoot: `${pluginDataRoot}/downloads/${operationId}`,
        backupRoot: `${pluginDataRoot}/pre-download-backups/${operationId}`,
        replaceableConfigPrefix: `${this.app.vault.configDir}/`,
        onProgress: (progress) => {
          this.initialDownloadProgress = progress;
          this.syncStatus.set({
            ...this.syncStatus.get(),
            phase: 'syncing',
            message: `Primeiro download: ${progress.completedFiles} de ${progress.totalFiles} arquivos.`,
          });
          this.settingTab?.refreshProgress();
        },
      });
      this.settings.initialSyncCompletedAt = result.completedAt;
      await this.savePluginData();
      this.syncStatus.set({
        phase: 'up-to-date',
        lastSyncAt: result.completedAt,
        counters: { uploaded: 0, downloaded: result.downloadedFiles },
        message: 'Primeiro download concluído e arquivos verificados.',
      });
      new Notice(
        `Download concluído: ${result.downloadedFiles} baixados, ${result.alreadyPresentFiles} já existentes e ${result.ignoredFiles} ignorados. Reinicie o Obsidian para carregar todas as configurações.`,
        10_000,
      );
    } catch (error) {
      this.syncStatus.set({
        ...this.syncStatus.get(),
        phase: 'error',
        message: `Primeiro download interrompido: ${errorMessage(error)}`,
      });
      new Notice(`Primeiro download interrompido: ${errorMessage(error)}`, 10_000);
    } finally {
      this.initialDownloadRunning = false;
      this.initialDownloadProgress = null;
      this.settingTab?.display();
    }
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
  }

  async analyzeVault(): Promise<void> {
    if (this.inventoryRunning) {
      new Notice('A análise do cofre já está em andamento.');
      return;
    }

    this.inventoryRunning = true;
    this.inventoryProgress = { processedFiles: 0, discoveredFiles: 0, currentPath: null };
    this.settingTab?.display();
    new Notice('Analisando o cofre em modo somente leitura…');

    try {
      const service = new VaultInventoryService(this.app.vault.adapter);
      const snapshot = await service.scan({
        ignoredPaths: this.settings.ignoredPaths,
        onProgress: (progress) => {
          this.inventoryProgress = progress;
          this.settingTab?.refreshProgress();
        },
      });
      this.inventoryState = recordInventory(this.inventoryState, snapshot);
      await this.savePluginData();
      new Notice(
        `Análise concluída: ${snapshot.summary.fileCount} arquivos, ${snapshot.summary.failedCount} falhas.`,
      );
    } catch (error) {
      new Notice(`Não foi possível analisar o cofre: ${errorMessage(error)}`);
    } finally {
      this.inventoryRunning = false;
      this.inventoryProgress = null;
      this.settingTab?.display();
    }
  }

  private async loadSettings(): Promise<void> {
    const defaults = createDefaultSettings(this.app.vault.configDir, this.manifest.id);
    const storedData: unknown = await this.loadData();
    const data = parsePluginData(storedData, defaults);
    this.settings = data.settings;
    this.inventoryState = data.inventory;
    if (!isCurrentPluginData(storedData)) {
      await this.savePluginData();
    }
  }

  private async savePluginData(): Promise<void> {
    await this.saveData({
      schemaVersion: 2,
      settings: this.settings,
      inventory: this.inventoryState,
    });
  }

  private createDriveClient(): DriveClient {
    if (this.googleOAuth === null) throw new Error('O serviço Google não foi inicializado.');
    return new DriveClient(new ObsidianHttpTransport(), {
      getAccessToken: () => this.googleOAuth!.getValidAccessToken(this.settings.oauthWorkerUrl),
    });
  }

  private async finishGoogleAuthorization(data: ObsidianProtocolData): Promise<void> {
    if (this.googleOAuth === null) return;
    try {
      const tokens = await this.googleOAuth.finishAuthorization(data);
      this.connectedGoogleEmail = tokens.email;
      this.syncStatus.set({
        ...this.syncStatus.get(),
        message: 'Conta Google conectada. Teste o Drive e escolha um cofre remoto.',
      });
      this.settingTab?.display();
      new Notice(`Conta Google conectada: ${tokens.email}`);
    } catch (error) {
      new Notice(`Não foi possível concluir o acesso ao Google: ${errorMessage(error)}`);
    }
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  if (/unknownhostexception|unable to resolve host|name_not_resolved/iu.test(message)) {
    return 'O celular não conseguiu acessar o Google. Verifique Wi-Fi ou dados móveis, DNS privado, VPN e bloqueadores; depois tente novamente.';
  }
  return message;
}

function createPortableId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formatPercent(value: number, total: number): number {
  return total <= 0 ? 0 : Math.round((value / total) * 100);
}

function initialSyncModeMessage(mode: DriveSyncSettings['initialSyncMode']): string {
  if (mode === 'upload-local') {
    return 'Modo escolhido: enviar o conteúdo local. Aguardando revisão antes do primeiro envio.';
  }
  if (mode === 'download-remote') {
    return 'Modo escolhido: baixar o cofre remoto. Aguardando revisão antes de alterar o cofre local.';
  }
  return 'Modo escolhido: combinar os conteúdos. Aguardando revisão segura de conflitos.';
}
