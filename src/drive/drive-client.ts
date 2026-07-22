import { createDriveApiError } from './drive-api-error';
import type {
  AccessTokenProvider,
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from './http-transport';
import { DEFAULT_RETRY_POLICY, withDriveRetry, type RetryPolicy } from './retry';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const UPLOAD_CHUNK_GRANULARITY = 256 * 1024;
const DEFAULT_UPLOAD_CHUNK_SIZE = 8 * UPLOAD_CHUNK_GRANULARITY;
// Obsidian's native request transport can carry a bounded multipart request
// where some Electron builds reject resumable binary PUT requests. The
// compatibility ceiling is verified by the large-file diagnostic before use.
const MULTIPART_UPLOAD_LIMIT = 20 * 1024 * 1024;
const FILE_FIELDS =
  'id,name,mimeType,parents,size,modifiedTime,md5Checksum,trashed,createdTime,appProperties';

export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents: readonly string[];
  readonly size: number | null;
  readonly modifiedTime: string | null;
  readonly createdTime: string | null;
  readonly md5Checksum: string | null;
  readonly trashed: boolean;
  readonly appProperties: Readonly<Record<string, string>>;
}

export interface CreateFolderInput {
  readonly name: string;
  readonly parentId?: string;
  readonly appProperties?: Readonly<Record<string, string>>;
}

export interface ResumableUploadInput {
  readonly name: string;
  readonly parentId: string;
  readonly mimeType: string;
  readonly data: ArrayBuffer;
  readonly existingFileId?: string;
  readonly appProperties?: Readonly<Record<string, string>>;
  readonly chunkSizeBytes?: number;
  readonly onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

export class DriveClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly tokenProvider: AccessTokenProvider,
    private readonly retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  async listChildren(parentId: string): Promise<DriveFile[]> {
    const query = `'${escapeDriveQueryValue(parentId)}' in parents and trashed = false`;
    return this.listFiles(query);
  }

  async listFiles(query: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | null = null;

    do {
      const parameters = new URLSearchParams({
        q: query,
        spaces: 'drive',
        pageSize: '1000',
        fields: `nextPageToken,files(${FILE_FIELDS})`,
      });
      if (pageToken !== null) {
        parameters.set('pageToken', pageToken);
      }

      const response = await this.authorizedRequest({
        url: `${DRIVE_API}/files?${parameters.toString()}`,
        method: 'GET',
      });
      const page = parseFileList(response.json);
      files.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken !== null);

    return files;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const parameters = new URLSearchParams({ fields: FILE_FIELDS });
    const response = await this.authorizedRequest({
      url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${parameters.toString()}`,
      method: 'GET',
    });
    return parseDriveFile(response.json);
  }

  async createFolder(input: CreateFolderInput): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
      name: input.name,
      mimeType: FOLDER_MIME_TYPE,
    };
    if (input.parentId !== undefined) {
      metadata.parents = [input.parentId];
    }
    if (input.appProperties !== undefined) {
      metadata.appProperties = input.appProperties;
    }

    const parameters = new URLSearchParams({ fields: FILE_FIELDS });
    const response = await this.authorizedRequest({
      url: `${DRIVE_API}/files?${parameters.toString()}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    });
    return parseDriveFile(response.json);
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const response = await this.authorizedRequest({
      url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
      method: 'GET',
    });
    return response.arrayBuffer;
  }

  async trashFile(fileId: string): Promise<void> {
    const parameters = new URLSearchParams({ fields: 'id,trashed' });
    await this.authorizedRequest({
      url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${parameters.toString()}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async uploadFile(input: ResumableUploadInput): Promise<DriveFile> {
    return input.data.byteLength <= MULTIPART_UPLOAD_LIMIT
      ? this.uploadMultipart(input)
      : this.uploadResumable(input);
  }

  async uploadResumable(input: ResumableUploadInput): Promise<DriveFile> {
    const chunkSize = input.chunkSizeBytes ?? DEFAULT_UPLOAD_CHUNK_SIZE;
    if (chunkSize <= 0 || chunkSize % UPLOAD_CHUNK_GRANULARITY !== 0) {
      throw new Error('O tamanho do bloco deve ser um múltiplo positivo de 256 KB.');
    }

    const sessionUrl = await this.startResumableUpload(input);
    let offset = 0;
    let consecutiveFailures = 0;

    while (offset < input.data.byteLength) {
      const endExclusive = Math.min(offset + chunkSize, input.data.byteLength);
      const chunk = input.data.slice(offset, endExclusive);
      const response = await this.transport.request({
        url: sessionUrl,
        method: 'PUT',
        headers: {
          'Content-Type': input.mimeType,
          'Content-Range': `bytes ${offset}-${endExclusive - 1}/${input.data.byteLength}`,
        },
        body: chunk,
      });

      if (response.status === 200 || response.status === 201) {
        input.onProgress?.(input.data.byteLength, input.data.byteLength);
        return parseDriveFile(response.json);
      }

      if (response.status === 308) {
        const nextOffset = readNextUploadOffset(response.headers);
        if (nextOffset <= offset) {
          throw new Error('O Google Drive não confirmou progresso no upload retomável.');
        }
        offset = nextOffset;
        consecutiveFailures = 0;
        input.onProgress?.(offset, input.data.byteLength);
        continue;
      }

      const error = createDriveApiError(response.status, response.json, response.headers);
      if (!error.retryable || consecutiveFailures >= this.retryPolicy.maxAttempts - 1) {
        throw error;
      }

      consecutiveFailures += 1;
      const status = await this.queryUploadStatus(sessionUrl, input.data.byteLength);
      if (status.file !== null) {
        return status.file;
      }
      offset = status.nextOffset;
      input.onProgress?.(offset, input.data.byteLength);
    }

    const status = await this.queryUploadStatus(sessionUrl, input.data.byteLength);
    if (status.file !== null) {
      return status.file;
    }
    throw new Error('Upload encerrado sem confirmação final do Google Drive.');
  }

  private async uploadMultipart(input: ResumableUploadInput): Promise<DriveFile> {
    const metadata: Record<string, unknown> = { name: input.name };
    if (input.existingFileId === undefined) metadata.parents = [input.parentId];
    if (input.appProperties !== undefined) metadata.appProperties = input.appProperties;

    const boundary = createMultipartBoundary();
    const prefix = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    );
    const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(prefix.byteLength + input.data.byteLength + suffix.byteLength);
    body.set(prefix, 0);
    body.set(new Uint8Array(input.data), prefix.byteLength);
    body.set(suffix, prefix.byteLength + input.data.byteLength);

    const filePath =
      input.existingFileId === undefined
        ? '/files'
        : `/files/${encodeURIComponent(input.existingFileId)}`;
    const parameters = new URLSearchParams({ uploadType: 'multipart', fields: FILE_FIELDS });
    const response = await this.authorizedRequest({
      url: `${DRIVE_UPLOAD_API}${filePath}?${parameters.toString()}`,
      method: input.existingFileId === undefined ? 'POST' : 'PATCH',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: body.buffer,
    });
    input.onProgress?.(input.data.byteLength, input.data.byteLength);
    return parseDriveFile(response.json);
  }

  private async startResumableUpload(input: ResumableUploadInput): Promise<string> {
    const metadata: Record<string, unknown> = {
      name: input.name,
    };
    if (input.existingFileId === undefined) metadata.parents = [input.parentId];
    if (input.appProperties !== undefined) {
      metadata.appProperties = input.appProperties;
    }
    const filePath =
      input.existingFileId === undefined
        ? '/files'
        : `/files/${encodeURIComponent(input.existingFileId)}`;
    const parameters = new URLSearchParams({ uploadType: 'resumable', fields: FILE_FIELDS });
    const response = await this.authorizedRequest({
      url: `${DRIVE_UPLOAD_API}${filePath}?${parameters.toString()}`,
      method: input.existingFileId === undefined ? 'POST' : 'PATCH',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': input.mimeType,
        'X-Upload-Content-Length': String(input.data.byteLength),
      },
      body: JSON.stringify(metadata),
    });
    const location = findHeader(response.headers, 'location');
    if (location === null || !isTrustedUploadSessionUrl(location)) {
      throw new Error('O Google Drive não retornou uma sessão de upload confiável.');
    }
    return location;
  }

  private async queryUploadStatus(
    sessionUrl: string,
    totalBytes: number,
  ): Promise<{ nextOffset: number; file: DriveFile | null }> {
    return withDriveRetry(async () => {
      const response = await this.transport.request({
        url: sessionUrl,
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${totalBytes}` },
        body: new ArrayBuffer(0),
      });
      if (response.status === 200 || response.status === 201) {
        return { nextOffset: totalBytes, file: parseDriveFile(response.json) };
      }
      if (response.status === 308) {
        return { nextOffset: readNextUploadOffset(response.headers), file: null };
      }
      throw createDriveApiError(response.status, response.json, response.headers);
    }, this.retryPolicy);
  }

  private async authorizedRequest(request: HttpRequest): Promise<HttpResponse> {
    return withDriveRetry(async () => {
      const accessToken = await this.tokenProvider.getAccessToken();
      const response = await this.transport.request({
        ...request,
        headers: {
          ...request.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (response.status < 200 || response.status >= 300) {
        throw createDriveApiError(response.status, response.json, response.headers);
      }

      return response;
    }, this.retryPolicy);
  }
}

function createMultipartBoundary(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `obsidian-drive-sync-${suffix}`;
}

function readNextUploadOffset(headers: Readonly<Record<string, string>>): number {
  const range = findHeader(headers, 'range');
  if (range === null) {
    return 0;
  }
  const match = /^bytes=0-(\d+)$/u.exec(range);
  if (match?.[1] === undefined) {
    throw new Error('Faixa inválida na resposta do upload retomável.');
  }
  return Number(match[1]) + 1;
}

function findHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  return entry?.[1] ?? null;
}

function isTrustedUploadSessionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'www.googleapis.com' || url.hostname.endsWith('.googleapis.com'))
    );
  } catch {
    return false;
  }
}

function parseFileList(value: unknown): { files: DriveFile[]; nextPageToken: string | null } {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new Error('Resposta inválida ao listar arquivos do Google Drive.');
  }

  return {
    files: value.files.map(parseDriveFile),
    nextPageToken: typeof value.nextPageToken === 'string' ? value.nextPageToken : null,
  };
}

function parseDriveFile(value: unknown): DriveFile {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string'
  ) {
    throw new Error('Metadados inválidos recebidos do Google Drive.');
  }

  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    parents: readStringArray(value.parents),
    size: readDriveSize(value.size),
    modifiedTime: typeof value.modifiedTime === 'string' ? value.modifiedTime : null,
    createdTime: typeof value.createdTime === 'string' ? value.createdTime : null,
    md5Checksum: typeof value.md5Checksum === 'string' ? value.md5Checksum : null,
    trashed: value.trashed === true,
    appProperties: readStringRecord(value.appProperties),
  };
}

function readDriveSize(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    return null;
  }
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
