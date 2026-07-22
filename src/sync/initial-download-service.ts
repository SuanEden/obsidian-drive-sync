import type { DataAdapter, Stat } from 'obsidian';

import { shouldIgnoreVaultPath } from '../domain/ignore-pattern';
import type { LiveFileMetadata, SyncManifest } from '../domain/file-metadata';
import { validateVaultRelativePath } from '../domain/vault-path';
import type { DriveFile } from '../drive/drive-client';
import type { RemoteVaultStructure } from '../drive/remote-vault-structure';
import { calculateSha256 } from '../services/sha256';

export interface InitialDownloadDriveOperations {
  listChildren(parentId: string): Promise<DriveFile[]>;
  downloadFile(fileId: string): Promise<ArrayBuffer>;
}

export interface InitialDownloadProgress {
  readonly completedFiles: number;
  readonly totalFiles: number;
  readonly currentPath: string;
  readonly phase: 'checking' | 'downloading' | 'applying';
}

export interface InitialDownloadResult {
  readonly downloadedFiles: number;
  readonly alreadyPresentFiles: number;
  readonly ignoredFiles: number;
  readonly completedAt: string;
}

interface DownloadItem {
  readonly path: string;
  readonly metadata: LiveFileMetadata;
  readonly stagingPath: string;
  readonly originalHash: string | null;
}

export class InitialDownloadService {
  constructor(
    private readonly adapter: Pick<
      DataAdapter,
      'exists' | 'stat' | 'readBinary' | 'writeBinary' | 'mkdir'
    >,
    private readonly drive: InitialDownloadDriveOperations,
  ) {}

  async download(options: {
    structure: RemoteVaultStructure;
    vaultId: string;
    ignoredPaths: readonly string[];
    stagingRoot: string;
    replaceableConfigPrefix: string;
    backupRoot: string;
    onProgress?: (progress: InitialDownloadProgress) => void;
  }): Promise<InitialDownloadResult> {
    const manifest = await this.readManifest(options.structure.syncDataFolderId, options.vaultId);
    const liveEntries = Object.values(manifest.files).filter(
      (entry): entry is LiveFileMetadata => !entry.deleted,
    );
    const ignoredFiles = liveEntries.filter((entry) =>
      shouldIgnoreVaultPath(entry.path, options.ignoredPaths),
    ).length;
    const entries = liveEntries.filter(
      (entry) => !shouldIgnoreVaultPath(entry.path, options.ignoredPaths),
    );
    const pending: DownloadItem[] = [];
    let alreadyPresentFiles = 0;

    for (const [index, metadata] of entries.entries()) {
      options.onProgress?.({
        completedFiles: index,
        totalFiles: entries.length,
        currentPath: metadata.path,
        phase: 'checking',
      });
      const path = requireSafeManifestPath(metadata.path);
      if (await this.adapter.exists(path, true)) {
        const stat = await this.adapter.stat(path);
        if (stat?.type !== 'file') {
          throw new Error(`O arquivo local difere do remoto e não será sobrescrito: ${path}`);
        }
        if (await this.matchesLocalFile(path, stat, metadata)) {
          alreadyPresentFiles += 1;
          continue;
        }
        if (!path.startsWith(options.replaceableConfigPrefix)) {
          throw new Error(`O arquivo local difere do remoto e não será sobrescrito: ${path}`);
        }
        pending.push({
          path,
          metadata,
          stagingPath: `${options.stagingRoot}/${String(index).padStart(8, '0')}.part`,
          originalHash: await calculateSha256(await this.adapter.readBinary(path)),
        });
        continue;
      }
      if (metadata.remoteId === null) {
        throw new Error(`O manifesto não possui ID remoto para ${path}.`);
      }
      pending.push({
        path,
        metadata,
        stagingPath: `${options.stagingRoot}/${String(index).padStart(8, '0')}.part`,
        originalHash: null,
      });
    }

    await ensureDirectory(this.adapter, options.stagingRoot);
    for (const [index, item] of pending.entries()) {
      options.onProgress?.({
        completedFiles: index,
        totalFiles: pending.length,
        currentPath: item.path,
        phase: 'downloading',
      });
      const content = await this.drive.downloadFile(item.metadata.remoteId!);
      await verifyContent(content, item.metadata, item.path);
      await this.adapter.writeBinary(item.stagingPath, content);
    }

    for (const [index, item] of pending.entries()) {
      options.onProgress?.({
        completedFiles: index,
        totalFiles: pending.length,
        currentPath: item.path,
        phase: 'applying',
      });
      const exists = await this.adapter.exists(item.path, true);
      if (item.originalHash === null && exists) {
        throw new Error(`O arquivo apareceu durante o download e foi preservado: ${item.path}`);
      }
      if (item.originalHash !== null) {
        if (!exists)
          throw new Error(`O arquivo local desapareceu durante o download: ${item.path}`);
        const original = await this.adapter.readBinary(item.path);
        if ((await calculateSha256(original)) !== item.originalHash) {
          throw new Error(
            `O arquivo local mudou durante o download e foi preservado: ${item.path}`,
          );
        }
        const backupPath = `${options.backupRoot}/${item.path}`;
        await ensureDirectory(this.adapter, parentOf(backupPath));
        await this.adapter.writeBinary(backupPath, original);
      }
      const content = await this.adapter.readBinary(item.stagingPath);
      await verifyContent(content, item.metadata, item.path);
      await ensureDirectory(this.adapter, parentOf(item.path));
      const modifiedAt = Date.parse(item.metadata.localModifiedAt ?? '');
      await this.adapter.writeBinary(
        item.path,
        content,
        Number.isNaN(modifiedAt) ? undefined : { mtime: modifiedAt },
      );
    }

    options.onProgress?.({
      completedFiles: pending.length,
      totalFiles: pending.length,
      currentPath: 'Concluído',
      phase: 'applying',
    });
    return {
      downloadedFiles: pending.length,
      alreadyPresentFiles,
      ignoredFiles,
      completedAt: new Date().toISOString(),
    };
  }

  private async readManifest(syncDataFolderId: string, vaultId: string): Promise<SyncManifest> {
    const children = await this.drive.listChildren(syncDataFolderId);
    const manifests = children.filter(
      (item) =>
        item.appProperties['obsidianDriveSyncVaultId'] === vaultId &&
        item.appProperties['obsidianDriveSyncRole'] === 'manifest',
    );
    if (manifests.length !== 1) {
      throw new Error(
        manifests.length === 0
          ? 'O cofre remoto ainda não possui um manifesto concluído.'
          : 'Há mais de um manifesto remoto para este cofre.',
      );
    }
    const content = await this.drive.downloadFile(manifests[0]!.id);
    return parseManifest(new TextDecoder().decode(content), vaultId);
  }

  private async matchesLocalFile(
    path: string,
    stat: Stat,
    metadata: LiveFileMetadata,
  ): Promise<boolean> {
    if (stat.size !== metadata.size) return false;
    return (await calculateSha256(await this.adapter.readBinary(path))) === metadata.hash;
  }
}

function parseManifest(value: string, vaultId: string): SyncManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('O manifesto remoto não contém JSON válido.');
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.vaultId !== vaultId ||
    typeof parsed.revision !== 'string' ||
    typeof parsed.generatedAt !== 'string' ||
    typeof parsed.generatedByDeviceId !== 'string' ||
    !isRecord(parsed.files)
  ) {
    throw new Error('O manifesto remoto é incompatível ou pertence a outro cofre.');
  }
  const files: Record<string, LiveFileMetadata> = {};
  for (const [path, metadata] of Object.entries(parsed.files)) {
    if (!isLiveMetadata(metadata) || metadata.path !== path) {
      throw new Error(`Metadados remotos inválidos para ${path}.`);
    }
    files[path] = metadata;
  }
  return { ...parsed, files } as SyncManifest;
}

function isLiveMetadata(value: unknown): value is LiveFileMetadata {
  return (
    isRecord(value) &&
    value.deleted === false &&
    typeof value.path === 'string' &&
    (typeof value.remoteId === 'string' || value.remoteId === null) &&
    (typeof value.localModifiedAt === 'string' || value.localModifiedAt === null) &&
    (typeof value.remoteModifiedAt === 'string' || value.remoteModifiedAt === null) &&
    typeof value.lastSyncedVersion === 'string' &&
    (typeof value.changedByDeviceId === 'string' || value.changedByDeviceId === null) &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.hash === 'string' &&
    /^sha256:[a-f0-9]{64}$/u.test(value.hash)
  );
}

function requireSafeManifestPath(path: string): string {
  const validation = validateVaultRelativePath(path);
  if (!validation.valid) throw new Error(`Caminho remoto inseguro: ${path}`);
  return validation.path;
}

async function verifyContent(
  content: ArrayBuffer,
  metadata: LiveFileMetadata,
  path: string,
): Promise<void> {
  if (content.byteLength !== metadata.size || (await calculateSha256(content)) !== metadata.hash) {
    throw new Error(`Falha de integridade ao baixar ${path}.`);
  }
}

async function ensureDirectory(
  adapter: Pick<DataAdapter, 'exists' | 'mkdir'>,
  path: string,
): Promise<void> {
  if (path.length === 0 || (await adapter.exists(path, true))) return;
  await ensureDirectory(adapter, parentOf(path));
  if (!(await adapter.exists(path, true))) await adapter.mkdir(path);
}

function parentOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
