import { describe, expect, it, vi } from 'vitest';

import type { DriveFile } from '../src/drive/drive-client';
import { LargeUploadDiagnosticService } from '../src/sync/large-upload-diagnostic-service';

function uploadedFile(): DriveFile {
  return {
    id: 'diagnostic-id',
    name: 'teste.bin',
    mimeType: 'application/octet-stream',
    parents: ['sync-data'],
    size: 18 * 1024 * 1024,
    modifiedTime: null,
    createdTime: null,
    md5Checksum: null,
    trashed: false,
    appProperties: {},
  };
}

describe('LargeUploadDiagnosticService', () => {
  it('verifica o retorno e sempre envia o arquivo artificial para a lixeira', async () => {
    let content = new ArrayBuffer(0);
    const trashFile = vi.fn<(id: string) => Promise<void>>().mockResolvedValue();
    const service = new LargeUploadDiagnosticService({
      uploadFile: (input) => {
        content = input.data.slice(0);
        return Promise.resolve(uploadedFile());
      },
      downloadFile: () => Promise.resolve(content.slice(0)),
      trashFile,
    });

    await service.run({ parentId: 'sync-data', vaultId: 'vault-id' });

    expect(content.byteLength).toBe(18 * 1024 * 1024);
    expect(trashFile).toHaveBeenCalledWith('diagnostic-id');
  });

  it('move o teste para a lixeira mesmo se a verificação falhar', async () => {
    const trashFile = vi.fn<(id: string) => Promise<void>>().mockResolvedValue();
    const service = new LargeUploadDiagnosticService({
      uploadFile: () => Promise.resolve(uploadedFile()),
      downloadFile: () => Promise.resolve(new ArrayBuffer(1)),
      trashFile,
    });

    await expect(service.run({ parentId: 'sync-data', vaultId: 'vault-id' })).rejects.toThrow(
      'diferente',
    );
    expect(trashFile).toHaveBeenCalledWith('diagnostic-id');
  });
});
