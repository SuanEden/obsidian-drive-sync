import { describe, expect, it } from 'vitest';

import type { DeletedFileMetadata, LiveFileMetadata } from '../src/domain/file-metadata';
import { decideSyncAction, type FirstSyncMode, type SyncAction } from '../src/domain/sync-decision';

const PATH = 'Notas/projeto.md';

function live(hash: string): LiveFileMetadata {
  return {
    path: PATH,
    remoteId: 'remote-id',
    size: 10,
    localModifiedAt: '2026-07-21T10:00:00.000Z',
    remoteModifiedAt: '2026-07-21T10:00:00.000Z',
    hash: `sha256:${hash}`,
    lastSyncedVersion: 'version-1',
    changedByDeviceId: 'desktop',
    deleted: false,
  };
}

function deleted(): DeletedFileMetadata {
  return {
    path: PATH,
    remoteId: 'remote-id',
    size: 0,
    localModifiedAt: null,
    remoteModifiedAt: '2026-07-21T11:00:00.000Z',
    hash: null,
    lastSyncedVersion: 'version-2',
    changedByDeviceId: 'celular',
    deleted: true,
    deletedAt: '2026-07-21T11:00:00.000Z',
  };
}

describe('decideSyncAction na primeira sincronização', () => {
  it.each<[FirstSyncMode, SyncAction]>([
    ['upload-local', 'upload-new'],
    ['merge', 'upload-new'],
    ['download-remote', 'conflict'],
  ])('trata arquivo somente local no modo %s como %s', (firstSyncMode, action) => {
    expect(
      decideSyncAction({ local: live('local'), remote: null, base: null, firstSyncMode }),
    ).toMatchObject({ action });
  });

  it.each<[FirstSyncMode, SyncAction]>([
    ['download-remote', 'download-new'],
    ['merge', 'download-new'],
    ['upload-local', 'conflict'],
  ])('trata arquivo somente remoto no modo %s como %s', (firstSyncMode, action) => {
    expect(
      decideSyncAction({ local: null, remote: live('remote'), base: null, firstSyncMode }),
    ).toMatchObject({ action });
  });

  it('adota arquivos com hashes iguais sem transferência', () => {
    expect(
      decideSyncAction({
        local: live('igual'),
        remote: live('igual'),
        base: null,
        firstSyncMode: 'merge',
      }),
    ).toEqual({ action: 'adopt-identical', reason: 'same-content', requiresPreservation: false });
  });

  it('preserva ambos quando os hashes diferem', () => {
    expect(
      decideSyncAction({
        local: live('local'),
        remote: live('remote'),
        base: null,
        firstSyncMode: 'merge',
      }),
    ).toMatchObject({ action: 'conflict', requiresPreservation: true });
  });

  it('não ressuscita arquivo diante de tombstone sem base comum', () => {
    expect(
      decideSyncAction({
        local: live('antigo'),
        remote: deleted(),
        base: null,
        firstSyncMode: 'merge',
      }),
    ).toMatchObject({ action: 'conflict', reason: 'tombstone-without-common-base' });
  });
});

describe('decideSyncAction após uma sincronização conhecida', () => {
  it('não usa datas para trocar conteúdo com hash inalterado', () => {
    const base = live('igual');
    const remote = { ...live('igual'), remoteModifiedAt: '2099-01-01T00:00:00.000Z' };

    expect(decideSyncAction({ local: base, remote, base, firstSyncMode: 'merge' })).toMatchObject({
      action: 'none',
    });
  });

  it('envia uma alteração somente local', () => {
    const base = live('base');
    expect(
      decideSyncAction({ local: live('local'), remote: base, base, firstSyncMode: 'merge' }),
    ).toMatchObject({ action: 'upload-update', reason: 'local-changed' });
  });

  it('baixa uma alteração somente remota', () => {
    const base = live('base');
    expect(
      decideSyncAction({ local: base, remote: live('remote'), base, firstSyncMode: 'merge' }),
    ).toMatchObject({ action: 'download-update', reason: 'remote-changed' });
  });

  it('propaga exclusão local usando lixeira remota', () => {
    const base = live('base');
    expect(decideSyncAction({ local: null, remote: base, base, firstSyncMode: 'merge' })).toEqual({
      action: 'trash-remote',
      reason: 'local-deleted',
      requiresPreservation: true,
    });
  });

  it('propaga exclusão remota usando lixeira local', () => {
    const base = live('base');
    expect(
      decideSyncAction({ local: base, remote: deleted(), base, firstSyncMode: 'merge' }),
    ).toEqual({ action: 'trash-local', reason: 'remote-deleted', requiresPreservation: true });
  });

  it('detecta conflito quando os dois lados mudaram de forma diferente', () => {
    const base = live('base');
    expect(
      decideSyncAction({
        local: live('local'),
        remote: live('remote'),
        base,
        firstSyncMode: 'merge',
      }),
    ).toEqual({
      action: 'conflict',
      reason: 'both-changed-differently',
      requiresPreservation: true,
    });
  });

  it('adota sem conflito quando ambos chegaram ao mesmo hash', () => {
    const base = live('base');
    expect(
      decideSyncAction({
        local: live('novo'),
        remote: live('novo'),
        base,
        firstSyncMode: 'merge',
      }),
    ).toMatchObject({ action: 'adopt-identical' });
  });
});
