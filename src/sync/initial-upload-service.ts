import type { DataAdapter } from 'obsidian';

import type { CreateFolderInput, DriveFile, ResumableUploadInput } from '../drive/drive-client';
import type { RemoteVaultStructure } from '../drive/remote-vault-structure';
import type { InventorySnapshot } from '../domain/inventory';
import type { FileMetadata, SyncManifest } from '../domain/file-metadata';
import { calculateSha256 } from '../services/sha256';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface InitialUploadDriveOperations {
  listChildren(parentId: string): Promise<DriveFile[]>;
  createFolder(input: CreateFolderInput): Promise<DriveFile>;
  uploadFile(input: ResumableUploadInput): Promise<DriveFile>;
}

export interface InitialUploadProgress {
  readonly completedFiles: number;
  readonly totalFiles: number;
  readonly currentPath: string;
}

export interface InitialUploadResult {
  readonly uploadedFiles: number;
  readonly manifestFileId: string;
  readonly completedAt: string;
}

export class InitialUploadService {
  private readonly childCache = new Map<string, DriveFile[]>();
  private readonly folderCache = new Map<string, string>();

  constructor(
    private readonly adapter: Pick<DataAdapter, 'readBinary'>,
    private readonly drive: InitialUploadDriveOperations,
  ) {}

  async upload(options: {
    snapshot: InventorySnapshot;
    structure: RemoteVaultStructure;
    vaultId: string;
    deviceId: string;
    onProgress?: (progress: InitialUploadProgress) => void;
  }): Promise<InitialUploadResult> {
    if (options.snapshot.failures.length > 0) {
      throw new Error('O inventário possui falhas e não pode ser enviado com segurança.');
    }

    this.folderCache.set('', options.structure.vaultFolderId);
    const metadata: Record<string, FileMetadata> = {};
    const entries = [...options.snapshot.entries].sort((left, right) =>
      left.path.localeCompare(right.path),
    );

    for (const [index, entry] of entries.entries()) {
      options.onProgress?.({
        completedFiles: index,
        totalFiles: entries.length,
        currentPath: entry.path,
      });
      const parentPath = parentOf(entry.path);
      const parentId = await this.ensureFolderPath(
        parentPath,
        options.structure.vaultFolderId,
        options.vaultId,
      );
      const data = await this.adapter.readBinary(entry.path);
      if (data.byteLength !== entry.size || (await calculateSha256(data)) !== entry.hash) {
        throw new Error(`O arquivo mudou depois do inventário: ${entry.path}`);
      }

      const pathId = await createPathId(entry.path);
      const children = await this.children(parentId);
      const matches = children.filter(
        (item) =>
          item.mimeType !== FOLDER_MIME_TYPE &&
          item.appProperties['obsidianDriveSyncVaultId'] === options.vaultId &&
          item.appProperties['obsidianDriveSyncRole'] === 'content-file' &&
          item.appProperties['obsidianDriveSyncPathId'] === pathId,
      );
      if (matches.length > 1) {
        throw new Error(`Há arquivos remotos duplicados para ${entry.path}.`);
      }
      const uploaded = await this.drive.uploadFile({
        name: nameOf(entry.path),
        parentId,
        mimeType: mimeTypeFor(entry.path),
        data,
        existingFileId: matches[0]?.id,
        appProperties: contentMarker(options.vaultId, 'content-file', pathId),
      });
      replaceChild(children, uploaded);
      metadata[entry.path] = {
        path: entry.path,
        remoteId: uploaded.id,
        localModifiedAt: entry.modifiedAt,
        remoteModifiedAt: uploaded.modifiedTime,
        lastSyncedVersion: entry.hash,
        changedByDeviceId: options.deviceId,
        deleted: false,
        size: entry.size,
        hash: entry.hash,
      };
    }

    const completedAt = new Date().toISOString();
    const manifest: SyncManifest = {
      schemaVersion: 1,
      vaultId: options.vaultId,
      revision: await createPathId(`${completedAt}:${options.deviceId}`),
      generatedAt: completedAt,
      generatedByDeviceId: options.deviceId,
      files: metadata,
    };
    const manifestData = new TextEncoder().encode(JSON.stringify(manifest)).buffer;
    const manifestChildren = await this.children(options.structure.syncDataFolderId);
    const existingManifests = manifestChildren.filter(
      (item) =>
        item.appProperties['obsidianDriveSyncVaultId'] === options.vaultId &&
        item.appProperties['obsidianDriveSyncRole'] === 'manifest',
    );
    if (existingManifests.length > 1) {
      throw new Error('Há mais de um manifesto remoto marcado para este cofre.');
    }
    const uploadedManifest = await this.drive.uploadFile({
      name: 'manifest.json',
      parentId: options.structure.syncDataFolderId,
      mimeType: 'application/json',
      data: manifestData,
      existingFileId: existingManifests[0]?.id,
      appProperties: {
        obsidianDriveSync: '1',
        obsidianDriveSyncVaultId: options.vaultId,
        obsidianDriveSyncRole: 'manifest',
      },
    });

    options.onProgress?.({
      completedFiles: entries.length,
      totalFiles: entries.length,
      currentPath: 'sync-data/manifest.json',
    });
    return {
      uploadedFiles: entries.length,
      manifestFileId: uploadedManifest.id,
      completedAt,
    };
  }

  private async ensureFolderPath(
    path: string,
    rootFolderId: string,
    vaultId: string,
  ): Promise<string> {
    if (path.length === 0) return rootFolderId;
    const cached = this.folderCache.get(path);
    if (cached !== undefined) return cached;

    const parentPath = parentOf(path);
    const parentId = await this.ensureFolderPath(parentPath, rootFolderId, vaultId);
    const pathId = await createPathId(path);
    const children = await this.children(parentId);
    const matches = children.filter(
      (item) =>
        item.mimeType === FOLDER_MIME_TYPE &&
        item.appProperties['obsidianDriveSyncVaultId'] === vaultId &&
        item.appProperties['obsidianDriveSyncRole'] === 'content-folder' &&
        item.appProperties['obsidianDriveSyncPathId'] === pathId,
    );
    if (matches.length > 1) throw new Error(`Há pastas remotas duplicadas para ${path}.`);
    const folder =
      matches[0] ??
      (await this.drive.createFolder({
        name: nameOf(path),
        parentId,
        appProperties: contentMarker(vaultId, 'content-folder', pathId),
      }));
    if (matches.length === 0) children.push(folder);
    this.folderCache.set(path, folder.id);
    return folder.id;
  }

  private async children(parentId: string): Promise<DriveFile[]> {
    const cached = this.childCache.get(parentId);
    if (cached !== undefined) return cached;
    const children = await this.drive.listChildren(parentId);
    this.childCache.set(parentId, children);
    return children;
  }
}

function contentMarker(vaultId: string, role: string, pathId: string): Record<string, string> {
  return {
    obsidianDriveSync: '1',
    obsidianDriveSyncVaultId: vaultId,
    obsidianDriveSyncRole: role,
    obsidianDriveSyncPathId: pathId,
  };
}

async function createPathId(path: string): Promise<string> {
  const hash = await calculateSha256(new TextEncoder().encode(path).buffer);
  return hash.slice('sha256:'.length, 'sha256:'.length + 32);
}

function parentOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function replaceChild(children: DriveFile[], file: DriveFile): void {
  const index = children.findIndex((item) => item.id === file.id);
  if (index < 0) children.push(file);
  else children[index] = file;
}

function mimeTypeFor(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLocaleLowerCase();
  const types: Record<string, string> = {
    md: 'text/markdown',
    json: 'application/json',
    css: 'text/css',
    js: 'text/javascript',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    webm: 'video/webm',
  };
  return types[extension] ?? 'application/octet-stream';
}
