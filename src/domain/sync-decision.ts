import { isDeletedFile, isLiveFile, type FileMetadata } from './file-metadata';

export type FirstSyncMode = 'upload-local' | 'download-remote' | 'merge';

export type SyncAction =
  | 'none'
  | 'adopt-identical'
  | 'upload-new'
  | 'download-new'
  | 'upload-update'
  | 'download-update'
  | 'trash-remote'
  | 'trash-local'
  | 'conflict';

export type SyncDecisionReason =
  | 'unchanged'
  | 'same-content'
  | 'local-created'
  | 'remote-created'
  | 'local-changed'
  | 'remote-changed'
  | 'local-deleted'
  | 'remote-deleted'
  | 'both-changed-differently'
  | 'unexpected-content-for-first-sync'
  | 'tombstone-without-common-base';

export interface SyncDecisionInput {
  readonly local: FileMetadata | null;
  readonly remote: FileMetadata | null;
  /** Estado confirmado na última sincronização deste aparelho. */
  readonly base: FileMetadata | null;
  readonly firstSyncMode: FirstSyncMode;
}

export interface SyncDecision {
  readonly action: SyncAction;
  readonly reason: SyncDecisionReason;
  /** Indica que o executor futuro deverá criar backup ou usar a lixeira. */
  readonly requiresPreservation: boolean;
}

/**
 * Decide por hash e estado conhecido. Datas nunca escolhem o vencedor.
 * Não executa operações e sempre transforma divergências ambíguas em conflito.
 */
export function decideSyncAction(input: SyncDecisionInput): SyncDecision {
  if (input.base === null) {
    return decideFirstSync(input.local, input.remote, input.firstSyncMode);
  }

  const localChanged = !sameState(input.local, input.base);
  const remoteChanged = !sameState(input.remote, input.base);

  if (!localChanged && !remoteChanged) {
    return decision('none', 'unchanged');
  }

  if (localChanged && remoteChanged) {
    if (sameState(input.local, input.remote)) {
      return decision('adopt-identical', 'same-content');
    }

    return decision('conflict', 'both-changed-differently', true);
  }

  if (localChanged) {
    if (isDeletedFile(input.local)) {
      return decision('trash-remote', 'local-deleted', true);
    }

    return decision(
      isDeletedFile(input.base) ? 'upload-new' : 'upload-update',
      'local-changed',
      true,
    );
  }

  if (isDeletedFile(input.remote)) {
    return decision('trash-local', 'remote-deleted', true);
  }

  return decision(
    isDeletedFile(input.base) ? 'download-new' : 'download-update',
    'remote-changed',
    true,
  );
}

function decideFirstSync(
  local: FileMetadata | null,
  remote: FileMetadata | null,
  mode: FirstSyncMode,
): SyncDecision {
  const localLive = isLiveFile(local);
  const remoteLive = isLiveFile(remote);

  if (!localLive && !remoteLive) {
    return decision('none', 'unchanged');
  }

  if (localLive && remoteLive) {
    if (local.hash === remote.hash) {
      return decision('adopt-identical', 'same-content');
    }

    return decision('conflict', 'both-changed-differently', true);
  }

  if (localLive) {
    if (remote?.deleted === true) {
      return decision('conflict', 'tombstone-without-common-base', true);
    }

    if (mode === 'download-remote') {
      return decision('conflict', 'unexpected-content-for-first-sync', true);
    }

    return decision('upload-new', 'local-created');
  }

  if (local?.deleted === true) {
    return decision('conflict', 'tombstone-without-common-base', true);
  }

  if (mode === 'upload-local') {
    return decision('conflict', 'unexpected-content-for-first-sync', true);
  }

  return decision('download-new', 'remote-created');
}

function sameState(left: FileMetadata | null, right: FileMetadata | null): boolean {
  if (isDeletedFile(left) && isDeletedFile(right)) {
    return true;
  }

  return isLiveFile(left) && isLiveFile(right) && left.hash === right.hash;
}

function decision(
  action: SyncAction,
  reason: SyncDecisionReason,
  requiresPreservation = false,
): SyncDecision {
  return { action, reason, requiresPreservation };
}
