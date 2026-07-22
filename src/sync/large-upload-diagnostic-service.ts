import type { DriveFile, ResumableUploadInput } from '../drive/drive-client';
import { calculateSha256 } from '../services/sha256';

const DIAGNOSTIC_SIZE = 18 * 1024 * 1024;

export interface LargeUploadDiagnosticOperations {
  uploadFile(input: ResumableUploadInput): Promise<DriveFile>;
  downloadFile(fileId: string): Promise<ArrayBuffer>;
  trashFile(fileId: string): Promise<void>;
}

export class LargeUploadDiagnosticService {
  constructor(private readonly drive: LargeUploadDiagnosticOperations) {}

  async run(options: {
    parentId: string;
    vaultId: string;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }): Promise<void> {
    const data = createDiagnosticData();
    const expectedHash = await calculateSha256(data);
    let uploaded: DriveFile | null = null;
    try {
      uploaded = await this.drive.uploadFile({
        name: 'obsidian-drive-sync-18mb-upload-test.bin',
        parentId: options.parentId,
        mimeType: 'application/octet-stream',
        data,
        appProperties: {
          obsidianDriveSync: '1',
          obsidianDriveSyncVaultId: options.vaultId,
          obsidianDriveSyncRole: 'diagnostic',
        },
        onProgress: options.onProgress,
      });
      const downloaded = await this.drive.downloadFile(uploaded.id);
      if (
        downloaded.byteLength !== data.byteLength ||
        (await calculateSha256(downloaded)) !== expectedHash
      ) {
        throw new Error('O arquivo grande retornou com conteúdo diferente do enviado.');
      }
    } finally {
      if (uploaded !== null) await this.drive.trashFile(uploaded.id);
    }
  }
}

function createDiagnosticData(): ArrayBuffer {
  const data = new Uint8Array(DIAGNOSTIC_SIZE);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = index % 251;
  }
  return data.buffer;
}
