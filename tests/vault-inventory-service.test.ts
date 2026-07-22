import type { DataAdapter, ListedFiles, Stat } from 'obsidian';
import { describe, expect, it } from 'vitest';

import { VaultInventoryService } from '../src/services/vault-inventory-service';

const CONTENT = new TextEncoder().encode('abc');
const CONTENT_BUFFER = CONTENT.buffer.slice(
  CONTENT.byteOffset,
  CONTENT.byteOffset + CONTENT.byteLength,
);
const FILE_STAT: Stat = { type: 'file', ctime: 1, mtime: 2, size: 3 };

function createAdapter(overrides: Partial<DataAdapter> = {}): DataAdapter {
  const listings: Record<string, ListedFiles> = {
    '': { files: ['nota.md', 'temporario.tmp'], folders: ['anexos', '.trash'] },
    anexos: { files: ['anexos/imagem.bin'], folders: [] },
  };
  return {
    list: (path: string): Promise<ListedFiles> =>
      Promise.resolve(listings[path] ?? { files: [], folders: [] }),
    stat: (): Promise<Stat> => Promise.resolve(FILE_STAT),
    readBinary: (): Promise<ArrayBuffer> => Promise.resolve(CONTENT_BUFFER),
    ...overrides,
  } as unknown as DataAdapter;
}

describe('VaultInventoryService', () => {
  it('percorre pastas, ignora padrões e calcula hashes de texto e binários', async () => {
    const service = new VaultInventoryService(
      createAdapter(),
      () => new Date('2026-07-21T12:00:00.000Z'),
    );

    const snapshot = await service.scan({ ignoredPaths: ['*.tmp', '.trash/'] });

    expect(snapshot.summary).toEqual({
      scannedAt: '2026-07-21T12:00:00.000Z',
      fileCount: 2,
      totalBytes: 6,
      ignoredCount: 2,
      failedCount: 0,
    });
    expect(snapshot.entries.map((entry) => entry.path)).toEqual(['nota.md', 'anexos/imagem.bin']);
    expect(snapshot.entries[0]?.hash).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('registra falha se o arquivo muda repetidamente durante a leitura', async () => {
    let statCall = 0;
    const adapter = createAdapter({
      list: (): Promise<ListedFiles> => Promise.resolve({ files: ['instavel.md'], folders: [] }),
      stat: (): Promise<Stat> => Promise.resolve({ ...FILE_STAT, mtime: statCall++ }),
    });
    const service = new VaultInventoryService(adapter);

    const snapshot = await service.scan({ ignoredPaths: [] });

    expect(snapshot.summary.failedCount).toBe(1);
    expect(snapshot.failures[0]?.message).toContain('mudou durante a leitura');
  });

  it('não percorre pasta com caminho inseguro retornado pelo Adapter', async () => {
    const visited: string[] = [];
    const adapter = createAdapter({
      list: (path: string): Promise<ListedFiles> => {
        visited.push(path);
        return Promise.resolve(
          path === '' ? { files: [], folders: ['../fora-do-cofre'] } : { files: [], folders: [] },
        );
      },
    });
    const service = new VaultInventoryService(adapter);

    const snapshot = await service.scan({ ignoredPaths: [] });

    expect(visited).toEqual(['']);
    expect(snapshot.summary.failedCount).toBe(1);
    expect(snapshot.failures[0]?.path).toBe('../fora-do-cofre');
  });
});
