export interface FileMetadataBase {
  /** Caminho relativo ao cofre, sempre com barras normais. */
  readonly path: string;
  /** ID estável do arquivo no Google Drive. */
  readonly remoteId: string | null;
  readonly localModifiedAt: string | null;
  readonly remoteModifiedAt: string | null;
  readonly lastSyncedVersion: string | null;
  readonly changedByDeviceId: string | null;
}

export interface LiveFileMetadata extends FileMetadataBase {
  readonly deleted: false;
  readonly size: number;
  /** Hash do conteúdo, no formato `sha256:<hex>`. */
  readonly hash: string;
}

export interface DeletedFileMetadata extends FileMetadataBase {
  readonly deleted: true;
  readonly size: 0;
  readonly hash: null;
  readonly deletedAt: string;
}

export type FileMetadata = LiveFileMetadata | DeletedFileMetadata;

export interface SyncManifest {
  readonly schemaVersion: 1;
  readonly vaultId: string;
  readonly revision: string;
  readonly generatedAt: string;
  readonly generatedByDeviceId: string;
  readonly files: Readonly<Record<string, FileMetadata>>;
}

export function isLiveFile(metadata: FileMetadata | null): metadata is LiveFileMetadata {
  return metadata !== null && !metadata.deleted;
}

export function isDeletedFile(metadata: FileMetadata | null): boolean {
  return metadata === null || metadata.deleted;
}
