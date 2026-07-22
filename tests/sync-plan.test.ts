import { describe, expect, it } from 'vitest';

import type { FileMetadata, LiveFileMetadata } from '../src/domain/file-metadata';
import type { InventorySnapshot } from '../src/domain/inventory';
import { buildSyncPlan } from '../src/sync/sync-plan';

function localInventory(files: Array<{ path: string; hash: string }>): InventorySnapshot {
  return {
    summary: {
      scannedAt: '2026-07-21T10:00:00.000Z',
      fileCount: files.length,
      totalBytes: files.length,
      ignoredCount: 0,
      failedCount: 0,
    },
    entries: files.map((file) => ({
      path: file.path,
      hash: `sha256:${file.hash}`,
      size: 1,
      modifiedAt: '2026-07-21T10:00:00.000Z',
    })),
    failures: [],
  };
}

function metadata(path: string, hash: string): LiveFileMetadata {
  return {
    path,
    remoteId: `id-${path}`,
    localModifiedAt: null,
    remoteModifiedAt: '2026-07-21T10:00:00.000Z',
    lastSyncedVersion: 'v1',
    changedByDeviceId: 'remoto',
    deleted: false,
    size: 1,
    hash: `sha256:${hash}`,
  };
}

describe('buildSyncPlan', () => {
  it('gera plano ordenado sem executar operações', () => {
    const base: Record<string, FileMetadata> = {
      'alterada.md': metadata('alterada.md', 'base'),
      'igual.md': metadata('igual.md', 'igual'),
    };
    const plan = buildSyncPlan({
      localInventory: localInventory([
        { path: 'nova.md', hash: 'nova' },
        { path: 'igual.md', hash: 'igual' },
        { path: 'alterada.md', hash: 'local' },
      ]),
      remoteFiles: base,
      baseFiles: base,
      firstSyncMode: 'merge',
      deviceId: 'linux',
      now: () => new Date('2026-07-21T12:00:00.000Z'),
    });

    expect(plan.entries.map((entry) => [entry.path, entry.decision.action])).toEqual([
      ['alterada.md', 'upload-update'],
      ['igual.md', 'none'],
      ['nova.md', 'upload-new'],
    ]);
    expect(plan.counts['upload-update']).toBe(1);
    expect(plan.counts['upload-new']).toBe(1);
    expect(plan.createdAt).toBe('2026-07-21T12:00:00.000Z');
  });

  it('preserva divergência dos dois lados como conflito', () => {
    const base = { 'nota.md': metadata('nota.md', 'base') };
    const plan = buildSyncPlan({
      localInventory: localInventory([{ path: 'nota.md', hash: 'local' }]),
      remoteFiles: { 'nota.md': metadata('nota.md', 'remote') },
      baseFiles: base,
      firstSyncMode: 'merge',
      deviceId: 'android',
    });

    expect(plan.entries[0]?.decision.action).toBe('conflict');
    expect(plan.entries[0]?.decision.requiresPreservation).toBe(true);
  });

  it('rejeita caminho remoto que tentaria sair do cofre', () => {
    const unsafe = metadata('../fora.md', 'x');
    expect(() =>
      buildSyncPlan({
        localInventory: localInventory([]),
        remoteFiles: { '../fora.md': unsafe },
        baseFiles: {},
        firstSyncMode: 'merge',
        deviceId: 'linux',
      }),
    ).toThrow('ponto duplo');
  });

  it('rejeita chave remota diferente do caminho declarado', () => {
    expect(() =>
      buildSyncPlan({
        localInventory: localInventory([]),
        remoteFiles: { 'a.md': metadata('b.md', 'x') },
        baseFiles: {},
        firstSyncMode: 'merge',
        deviceId: 'linux',
      }),
    ).toThrow('não corresponde');
  });
});
