import { describe, expect, it, vi } from 'vitest';

import type { InventorySnapshot } from '../src/domain/inventory';
import type { DriveFile, ResumableUploadInput } from '../src/drive/drive-client';
import type { RemoteVaultStructure } from '../src/drive/remote-vault-structure';
import { calculateSha256 } from '../src/services/sha256';
import {
  InitialUploadService,
  type InitialUploadDriveOperations,
} from '../src/sync/initial-upload-service';

const STRUCTURE: RemoteVaultStructure = {
  rootId: 'root',
  vaultFolderId: 'vault-folder',
  backupsFolderId: 'backups-folder',
  trashFolderId: 'trash-folder',
  syncDataFolderId: 'sync-data-folder',
};

describe('InitialUploadService', () => {
  it('envia arquivos, cria pastas e grava o manifesto somente ao final', async () => {
    const fixture = await createFixture();
    const progress = vi.fn();

    const result = await fixture.service.upload({
      snapshot: fixture.snapshot,
      structure: STRUCTURE,
      vaultId: 'vault-id',
      deviceId: 'Linux',
      onProgress: progress,
    });

    expect(result.uploadedFiles).toBe(2);
    expect(fixture.createdFolders.map((folder) => folder.name)).toEqual(['notas']);
    expect(
      fixture.uploads
        .slice(0, -1)
        .map((upload) => upload.name)
        .sort(),
    ).toEqual(['interna.json', 'raiz.md']);
    const manifestUpload = fixture.uploads[fixture.uploads.length - 1];
    expect(manifestUpload?.name).toBe('manifest.json');
    const manifest = JSON.parse(new TextDecoder().decode(manifestUpload?.data)) as {
      files: Record<string, { remoteId: string }>;
    };
    expect(Object.keys(manifest.files)).toEqual(['notas/interna.json', 'raiz.md']);
    expect(progress).toHaveBeenLastCalledWith({
      completedFiles: 2,
      totalFiles: 2,
      currentPath: 'sync-data/manifest.json',
    });
  });

  it('retoma usando marcadores sem duplicar pastas ou arquivos', async () => {
    const fixture = await createFixture();
    const options = {
      snapshot: fixture.snapshot,
      structure: STRUCTURE,
      vaultId: 'vault-id',
      deviceId: 'Linux',
    } as const;

    await fixture.service.upload(options);
    const firstFolderCount = fixture.createdFolders.length;
    const secondService = new InitialUploadService(fixture.adapter, fixture.drive);
    await secondService.upload(options);

    expect(fixture.createdFolders).toHaveLength(firstFolderCount);
    expect(fixture.uploads.slice(3).every((upload) => upload.existingFileId !== undefined)).toBe(
      true,
    );
  });

  it('interrompe se um arquivo mudou após o inventário', async () => {
    const fixture = await createFixture();
    fixture.contents.set('raiz.md', new TextEncoder().encode('alterado').buffer);

    await expect(
      fixture.service.upload({
        snapshot: fixture.snapshot,
        structure: STRUCTURE,
        vaultId: 'vault-id',
        deviceId: 'Linux',
      }),
    ).rejects.toThrow('mudou depois do inventário');
    expect(fixture.uploads.some((upload) => upload.name === 'manifest.json')).toBe(false);
  });
});

async function createFixture() {
  const contents = new Map<string, ArrayBuffer>([
    ['raiz.md', new TextEncoder().encode('raiz').buffer],
    ['notas/interna.json', new TextEncoder().encode('{"ok":true}').buffer],
  ]);
  const snapshot: InventorySnapshot = {
    summary: {
      scannedAt: new Date().toISOString(),
      fileCount: 2,
      totalBytes: 15,
      ignoredCount: 0,
      failedCount: 0,
    },
    entries: await Promise.all(
      [...contents].map(async ([path, data]) => ({
        path,
        size: data.byteLength,
        modifiedAt: '2026-07-21T12:00:00.000Z',
        hash: await calculateSha256(data),
      })),
    ),
    failures: [],
  };
  const children = new Map<string, DriveFile[]>([
    [STRUCTURE.vaultFolderId, []],
    [STRUCTURE.syncDataFolderId, []],
  ]);
  const createdFolders: Array<{ name: string; parentId?: string }> = [];
  const uploads: ResumableUploadInput[] = [];
  let nextId = 0;

  const drive: InitialUploadDriveOperations = {
    listChildren: (parentId) => Promise.resolve([...(children.get(parentId) ?? [])]),
    createFolder: (input) => {
      createdFolders.push(input);
      const file = driveFile(`folder-${nextId++}`, input.name, input.parentId ?? '', {
        ...input.appProperties,
      });
      children.set(input.parentId ?? '', [...(children.get(input.parentId ?? '') ?? []), file]);
      children.set(file.id, []);
      return Promise.resolve(file);
    },
    uploadFile: (input) => {
      uploads.push(input);
      const id = input.existingFileId ?? `file-${nextId++}`;
      const file = driveFile(
        id,
        input.name,
        input.parentId,
        { ...input.appProperties },
        input.data,
      );
      const siblings = children.get(input.parentId) ?? [];
      children.set(input.parentId, [...siblings.filter((item) => item.id !== id), file]);
      return Promise.resolve(file);
    },
  };
  const adapter = {
    readBinary: (path: string) => {
      const data = contents.get(path);
      if (data === undefined) return Promise.reject(new Error('arquivo ausente'));
      return Promise.resolve(data.slice(0));
    },
  };
  return {
    contents,
    snapshot,
    children,
    createdFolders,
    uploads,
    drive,
    adapter,
    service: new InitialUploadService(adapter, drive),
  };
}

function driveFile(
  id: string,
  name: string,
  parentId: string,
  appProperties: Record<string, string>,
  data?: ArrayBuffer,
): DriveFile {
  return {
    id,
    name,
    mimeType:
      data === undefined ? 'application/vnd.google-apps.folder' : 'application/octet-stream',
    parents: [parentId],
    size: data?.byteLength ?? null,
    modifiedTime: '2026-07-21T12:00:00.000Z',
    createdTime: '2026-07-21T12:00:00.000Z',
    md5Checksum: null,
    trashed: false,
    appProperties,
  };
}
