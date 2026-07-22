import type { CreateFolderInput, DriveClient, DriveFile } from './drive-client';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface RemoteVaultStructure {
  readonly rootId: string;
  readonly vaultFolderId: string;
  readonly backupsFolderId: string;
  readonly trashFolderId: string;
  readonly syncDataFolderId: string;
}

export interface DriveFolderOperations {
  listChildren(parentId: string): Promise<DriveFile[]>;
  listFiles?(query: string): Promise<DriveFile[]>;
  createFolder(input: CreateFolderInput): Promise<DriveFile>;
}

export interface RemoteVaultCandidate {
  readonly rootId: string;
  readonly vaultId: string;
  readonly name: string;
  readonly createdTime: string | null;
}

export class RemoteStructureConflictError extends Error {
  constructor(readonly role: RemoteFolderRole) {
    super(`Há mais de uma pasta remota marcada para a função ${role}.`);
    this.name = 'RemoteStructureConflictError';
  }
}

type RemoteFolderRole = 'vault' | 'backups' | 'trash' | 'sync-data';

const REQUIRED_FOLDERS: ReadonlyArray<{ role: RemoteFolderRole; name: string }> = [
  { role: 'vault', name: 'vault' },
  { role: 'backups', name: 'backups' },
  { role: 'trash', name: 'trash' },
  { role: 'sync-data', name: 'sync-data' },
];

export class RemoteVaultStructureService {
  constructor(private readonly drive: DriveFolderOperations) {}

  static fromDriveClient(drive: DriveClient): RemoteVaultStructureService {
    return new RemoteVaultStructureService(drive);
  }

  async discoverRoots(): Promise<RemoteVaultCandidate[]> {
    if (this.drive.listFiles === undefined) {
      throw new Error('A busca de cofres remotos não está disponível.');
    }
    const roots = await this.drive.listFiles(
      "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='obsidianDriveSync' and value='1' } and appProperties has { key='obsidianDriveSyncRole' and value='root' }",
    );
    return roots
      .flatMap((root) => {
        const vaultId = root.appProperties['obsidianDriveSyncVaultId'];
        return vaultId === undefined
          ? []
          : [{ rootId: root.id, vaultId, name: root.name, createdTime: root.createdTime }];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createRoot(
    name: string,
    vaultId: string,
    onRootCreated?: (rootId: string) => Promise<void>,
  ): Promise<RemoteVaultStructure> {
    const root = await this.drive.createFolder({
      name,
      appProperties: marker(vaultId, 'root'),
    });
    await onRootCreated?.(root.id);
    return this.ensure(root.id, vaultId);
  }

  async ensure(rootId: string, vaultId: string): Promise<RemoteVaultStructure> {
    const children = await this.drive.listChildren(rootId);
    const ids = new Map<RemoteFolderRole, string>();

    for (const required of REQUIRED_FOLDERS) {
      const matches = children.filter(
        (child) =>
          child.mimeType === FOLDER_MIME_TYPE &&
          child.appProperties['obsidianDriveSyncVaultId'] === vaultId &&
          child.appProperties['obsidianDriveSyncRole'] === required.role,
      );
      if (matches.length > 1) {
        throw new RemoteStructureConflictError(required.role);
      }

      const existing = matches[0];
      if (existing !== undefined) {
        ids.set(required.role, existing.id);
        continue;
      }

      const created = await this.drive.createFolder({
        name: required.name,
        parentId: rootId,
        appProperties: marker(vaultId, required.role),
      });
      ids.set(required.role, created.id);
    }

    return {
      rootId,
      vaultFolderId: requireRole(ids, 'vault'),
      backupsFolderId: requireRole(ids, 'backups'),
      trashFolderId: requireRole(ids, 'trash'),
      syncDataFolderId: requireRole(ids, 'sync-data'),
    };
  }
}

function marker(vaultId: string, role: RemoteFolderRole | 'root'): Record<string, string> {
  return {
    obsidianDriveSync: '1',
    obsidianDriveSyncVaultId: vaultId,
    obsidianDriveSyncRole: role,
  };
}

function requireRole(ids: ReadonlyMap<RemoteFolderRole, string>, role: RemoteFolderRole): string {
  const id = ids.get(role);
  if (id === undefined) {
    throw new Error(`A pasta remota ${role} não foi inicializada.`);
  }
  return id;
}
