import { describe, expect, it } from 'vitest';

import type { DriveFile } from '../src/drive/drive-client';
import { calculateSha256 } from '../src/services/sha256';
import { InitialDownloadService } from '../src/sync/initial-download-service';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MemoryAdapter {
  readonly files = new Map<string, ArrayBuffer>();
  readonly folders = new Set<string>(['']);

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.folders.has(path));
  }

  stat(path: string) {
    const file = this.files.get(path);
    if (file !== undefined) {
      return Promise.resolve({ type: 'file' as const, ctime: 0, mtime: 0, size: file.byteLength });
    }
    return Promise.resolve(
      this.folders.has(path) ? { type: 'folder' as const, ctime: 0, mtime: 0, size: 0 } : null,
    );
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    if (value === undefined) return Promise.reject(new Error(`Arquivo ausente: ${path}`));
    return Promise.resolve(value.slice(0));
  }

  writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data.slice(0));
    return Promise.resolve();
  }

  mkdir(path: string): Promise<void> {
    this.folders.add(path);
    return Promise.resolve();
  }
}

function driveFile(id: string): DriveFile {
  return {
    id,
    name: 'manifest.json',
    mimeType: 'application/json',
    parents: ['sync-data'],
    size: null,
    modifiedTime: null,
    createdTime: null,
    md5Checksum: null,
    trashed: false,
    appProperties: {
      obsidianDriveSyncVaultId: 'vault-id',
      obsidianDriveSyncRole: 'manifest',
    },
  };
}

async function manifest(
  files: Record<string, { id: string; content: string }>,
): Promise<ArrayBuffer> {
  const metadata: Record<string, unknown> = {};
  for (const [path, file] of Object.entries(files)) {
    const data = encoder.encode(file.content).buffer;
    const hash = await calculateSha256(data);
    metadata[path] = {
      path,
      remoteId: file.id,
      localModifiedAt: '2026-07-21T12:00:00.000Z',
      remoteModifiedAt: '2026-07-21T12:00:00.000Z',
      lastSyncedVersion: hash,
      changedByDeviceId: 'principal',
      deleted: false,
      size: data.byteLength,
      hash,
    };
  }
  return encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      vaultId: 'vault-id',
      revision: 'revision',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generatedByDeviceId: 'principal',
      files: metadata,
    }),
  ).buffer;
}

function options() {
  return {
    structure: {
      rootId: 'root',
      vaultFolderId: 'vault',
      backupsFolderId: 'backups',
      trashFolderId: 'trash',
      syncDataFolderId: 'sync-data',
    },
    vaultId: 'vault-id',
    ignoredPaths: ['.obsidian/plugins/obsidian-drive-sync/'],
    stagingRoot: '.obsidian/plugins/obsidian-drive-sync/sync-data/downloads/teste',
    backupRoot: '.obsidian/plugins/obsidian-drive-sync/sync-data/backups/teste',
    replaceableConfigPrefix: '.obsidian/',
  };
}

describe('InitialDownloadService', () => {
  it('valida tudo, baixa notas e guarda configuração local substituída', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set('.obsidian/app.json', encoder.encode('configuração local').buffer);
    const remote = {
      'nota.md': { id: 'note-id', content: '# Nota remota' },
      '.obsidian/app.json': { id: 'app-id', content: '{"tema":"escuro"}' },
    };
    const manifestData = await manifest(remote);
    const contents = new Map([
      ['manifest-id', manifestData],
      ...Object.values(remote).map(
        (file) => [file.id, encoder.encode(file.content).buffer] as const,
      ),
    ]);
    const service = new InitialDownloadService(adapter, {
      listChildren: () => Promise.resolve([driveFile('manifest-id')]),
      downloadFile: (id) => Promise.resolve(contents.get(id)!.slice(0)),
    });

    const result = await service.download(options());

    expect(result.downloadedFiles).toBe(2);
    expect(decoder.decode(adapter.files.get('nota.md'))).toBe('# Nota remota');
    expect(decoder.decode(adapter.files.get('.obsidian/app.json'))).toBe('{"tema":"escuro"}');
    expect(
      decoder.decode(
        adapter.files.get(
          '.obsidian/plugins/obsidian-drive-sync/sync-data/backups/teste/.obsidian/app.json',
        ),
      ),
    ).toBe('configuração local');
  });

  it('interrompe antes de baixar quando uma nota local é diferente', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set('nota.md', encoder.encode('não sobrescrever').buffer);
    const manifestData = await manifest({
      'nota.md': { id: 'note-id', content: 'conteúdo remoto' },
    });
    const service = new InitialDownloadService(adapter, {
      listChildren: () => Promise.resolve([driveFile('manifest-id')]),
      downloadFile: (id) =>
        id === 'manifest-id'
          ? Promise.resolve(manifestData)
          : Promise.reject(new Error('não deveria baixar')),
    });

    await expect(service.download(options())).rejects.toThrow('não será sobrescrito');
    expect(decoder.decode(adapter.files.get('nota.md'))).toBe('não sobrescrever');
  });

  it('não aplica um arquivo que falha na verificação de integridade', async () => {
    const adapter = new MemoryAdapter();
    const manifestData = await manifest({
      'nota.md': { id: 'note-id', content: 'conteúdo correto' },
    });
    const service = new InitialDownloadService(adapter, {
      listChildren: () => Promise.resolve([driveFile('manifest-id')]),
      downloadFile: (id) =>
        Promise.resolve(
          id === 'manifest-id' ? manifestData : encoder.encode('conteúdo corrompido').buffer,
        ),
    });

    await expect(service.download(options())).rejects.toThrow('integridade');
    expect(adapter.files.has('nota.md')).toBe(false);
  });
});
