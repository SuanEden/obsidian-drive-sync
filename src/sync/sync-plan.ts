import type { FileMetadata, LiveFileMetadata } from '../domain/file-metadata';
import type { InventorySnapshot } from '../domain/inventory';
import {
  decideSyncAction,
  type FirstSyncMode,
  type SyncAction,
  type SyncDecision,
} from '../domain/sync-decision';
import { assertVaultRelativePath } from '../domain/vault-path';

export interface SyncPlanEntry {
  readonly path: string;
  readonly decision: SyncDecision;
  readonly local: FileMetadata | null;
  readonly remote: FileMetadata | null;
  readonly base: FileMetadata | null;
}

export interface SyncPlan {
  readonly createdAt: string;
  readonly entries: readonly SyncPlanEntry[];
  readonly counts: Readonly<Record<SyncAction, number>>;
}

export interface BuildSyncPlanInput {
  readonly localInventory: InventorySnapshot;
  readonly remoteFiles: Readonly<Record<string, FileMetadata>>;
  readonly baseFiles: Readonly<Record<string, FileMetadata>>;
  readonly firstSyncMode: FirstSyncMode;
  readonly deviceId: string;
  readonly now?: () => Date;
}

export function buildSyncPlan(input: BuildSyncPlanInput): SyncPlan {
  const localFiles = localInventoryToMetadata(input.localInventory, input.deviceId);
  validateMetadataMap(input.remoteFiles);
  validateMetadataMap(input.baseFiles);

  const paths = new Set([
    ...Object.keys(localFiles),
    ...Object.keys(input.remoteFiles),
    ...Object.keys(input.baseFiles),
  ]);
  const entries = [...paths]
    .sort((left, right) => left.localeCompare(right))
    .map((path): SyncPlanEntry => {
      const local = localFiles[path] ?? null;
      const remote = input.remoteFiles[path] ?? null;
      const base = input.baseFiles[path] ?? null;
      return {
        path,
        local,
        remote,
        base,
        decision: decideSyncAction({ local, remote, base, firstSyncMode: input.firstSyncMode }),
      };
    });

  return {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    entries,
    counts: countActions(entries),
  };
}

function localInventoryToMetadata(
  inventory: InventorySnapshot,
  deviceId: string,
): Record<string, LiveFileMetadata> {
  const result: Record<string, LiveFileMetadata> = {};
  for (const entry of inventory.entries) {
    const path = assertVaultRelativePath(entry.path);
    if (result[path] !== undefined) {
      throw new Error(`O inventário local contém caminho duplicado: ${path}`);
    }
    result[path] = {
      path,
      remoteId: null,
      localModifiedAt: entry.modifiedAt,
      remoteModifiedAt: null,
      lastSyncedVersion: null,
      changedByDeviceId: deviceId,
      deleted: false,
      size: entry.size,
      hash: entry.hash,
    };
  }
  return result;
}

function validateMetadataMap(files: Readonly<Record<string, FileMetadata>>): void {
  for (const [key, metadata] of Object.entries(files)) {
    const path = assertVaultRelativePath(key);
    if (metadata.path !== path) {
      throw new Error(`O caminho ${key} não corresponde aos metadados recebidos.`);
    }
  }
}

function countActions(entries: readonly SyncPlanEntry[]): Record<SyncAction, number> {
  const counts: Record<SyncAction, number> = {
    none: 0,
    'adopt-identical': 0,
    'upload-new': 0,
    'download-new': 0,
    'upload-update': 0,
    'download-update': 0,
    'trash-remote': 0,
    'trash-local': 0,
    conflict: 0,
  };
  entries.forEach((entry) => {
    counts[entry.decision.action] += 1;
  });
  return counts;
}
