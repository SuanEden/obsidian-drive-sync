import { describe, expect, it, vi } from 'vitest';

import type { CreateFolderInput, DriveFile } from '../src/drive/drive-client';
import {
  RemoteStructureConflictError,
  RemoteVaultStructureService,
  type DriveFolderOperations,
} from '../src/drive/remote-vault-structure';

function folder(id: string, role: string, vaultId = 'vault-id'): DriveFile {
  return {
    id,
    name: role,
    mimeType: 'application/vnd.google-apps.folder',
    parents: ['root-id'],
    size: null,
    modifiedTime: null,
    createdTime: null,
    md5Checksum: null,
    trashed: false,
    appProperties: {
      obsidianDriveSync: '1',
      obsidianDriveSyncVaultId: vaultId,
      obsidianDriveSyncRole: role,
    },
  };
}

function operations(children: DriveFile[]): {
  drive: DriveFolderOperations;
  created: CreateFolderInput[];
} {
  const created: CreateFolderInput[] = [];
  return {
    created,
    drive: {
      listChildren: () => Promise.resolve(children),
      createFolder: (input) => {
        created.push(input);
        return Promise.resolve(folder(`created-${input.name}`, input.name));
      },
    },
  };
}

describe('RemoteVaultStructureService', () => {
  it('descobre somente raízes marcadas e preserva a escolha para a interface', async () => {
    const root = folder('root-id', 'root');
    const listFiles = vi.fn().mockResolvedValue([root]);
    const service = new RemoteVaultStructureService({
      listChildren: () => Promise.resolve([]),
      listFiles,
      createFolder: () => Promise.reject(new Error('não deveria criar')),
    });

    await expect(service.discoverRoots()).resolves.toEqual([
      { rootId: 'root-id', vaultId: 'vault-id', name: 'root', createdTime: null },
    ]);
    expect(listFiles).toHaveBeenCalledWith(expect.stringContaining("value='root'"));
  });

  it('reutiliza pastas pelos marcadores e cria somente as ausentes', async () => {
    const { drive, created } = operations([folder('vault-folder', 'vault')]);
    const service = new RemoteVaultStructureService(drive);

    const structure = await service.ensure('root-id', 'vault-id');

    expect(structure).toEqual({
      rootId: 'root-id',
      vaultFolderId: 'vault-folder',
      backupsFolderId: 'created-backups',
      trashFolderId: 'created-trash',
      syncDataFolderId: 'created-sync-data',
    });
    expect(created.map((item) => item.name)).toEqual(['backups', 'trash', 'sync-data']);
    expect(created.every((item) => item.parentId === 'root-id')).toBe(true);
  });

  it('não escolhe silenciosamente entre marcadores duplicados', async () => {
    const { drive } = operations([folder('vault-a', 'vault'), folder('vault-b', 'vault')]);
    const service = new RemoteVaultStructureService(drive);

    await expect(service.ensure('root-id', 'vault-id')).rejects.toBeInstanceOf(
      RemoteStructureConflictError,
    );
  });

  it('cria a raiz em Meu Drive e retorna IDs de toda a estrutura', async () => {
    const listChildren = vi.fn<DriveFolderOperations['listChildren']>().mockResolvedValue([]);
    const createFolder = vi
      .fn<DriveFolderOperations['createFolder']>()
      .mockImplementation((input) => Promise.resolve(folder(`id-${input.name}`, input.name)));
    const service = new RemoteVaultStructureService({ listChildren, createFolder });

    const structure = await service.createRoot('Meu cofre', 'vault-id');

    expect(createFolder.mock.calls[0]?.[0]).toMatchObject({
      name: 'Meu cofre',
      appProperties: { obsidianDriveSyncRole: 'root' },
    });
    expect(structure.rootId).toBe('id-Meu cofre');
    expect(structure.vaultFolderId).toBe('id-vault');
  });
});
