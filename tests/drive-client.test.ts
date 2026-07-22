import { describe, expect, it, vi } from 'vitest';

import type { DriveApiError } from '../src/drive/drive-api-error';
import { DriveClient } from '../src/drive/drive-client';
import type {
  AccessTokenProvider,
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from '../src/drive/http-transport';
import type { RetryPolicy } from '../src/drive/retry';

const EMPTY_BUFFER = new ArrayBuffer(0);

function response(
  status: number,
  json: unknown,
  headers: Record<string, string> = {},
): HttpResponse {
  return { status, json, headers, text: JSON.stringify(json), arrayBuffer: EMPTY_BUFFER };
}

function file(id: string, name = `${id}.md`): Record<string, unknown> {
  return {
    id,
    name,
    mimeType: 'text/markdown',
    parents: ['parent'],
    size: '12',
    modifiedTime: '2026-07-21T10:00:00.000Z',
    trashed: false,
  };
}

function tokenProvider(): AccessTokenProvider {
  return { getAccessToken: () => Promise.resolve('token-secreto') };
}

function retryPolicy(sleep = vi.fn<RetryPolicy['sleep']>()): RetryPolicy {
  sleep.mockResolvedValue(undefined);
  return { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, sleep, random: () => 0 };
}

describe('DriveClient', () => {
  it('percorre todas as páginas e envia o token somente no cabeçalho', async () => {
    const requests: HttpRequest[] = [];
    const pages = [
      response(200, { files: [file('a')], nextPageToken: 'pagina-2' }),
      response(200, { files: [file('b')] }),
    ];
    const transport: HttpTransport = {
      request: (request) => {
        requests.push(request);
        const next = pages.shift();
        if (next === undefined) {
          return Promise.reject(new Error('Página inesperada.'));
        }
        return Promise.resolve(next);
      },
    };
    const client = new DriveClient(transport, tokenProvider(), retryPolicy());

    const files = await client.listChildren("pasta'com-apostrofo");

    expect(files.map((item) => item.id)).toEqual(['a', 'b']);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers?.Authorization).toBe('Bearer token-secreto');
    expect(requests[0]?.url).not.toContain('token-secreto');
    expect(requests[1]?.url).toContain('pageToken=pagina-2');
    expect(requests[0]?.url).toContain('pageSize=1000');
  });

  it('repete 429 respeitando Retry-After', async () => {
    const sleep = vi.fn<RetryPolicy['sleep']>().mockResolvedValue(undefined);
    const responses = [
      response(
        429,
        { error: { message: 'Limite', errors: [{ reason: 'rateLimitExceeded' }] } },
        { 'Retry-After': '2' },
      ),
      response(200, { files: [] }),
    ];
    const transport: HttpTransport = {
      request: () => Promise.resolve(responses.shift() ?? response(500, {})),
    };
    const client = new DriveClient(transport, tokenProvider(), retryPolicy(sleep));

    await expect(client.listChildren('parent')).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('não repete erro de autenticação', async () => {
    const request = vi.fn<HttpTransport['request']>().mockResolvedValue(
      response(401, {
        error: { message: 'Credencial inválida', errors: [{ reason: 'authError' }] },
      }),
    );
    const client = new DriveClient({ request }, tokenProvider(), retryPolicy());

    const expected: Partial<DriveApiError> = {
      status: 401,
      reason: 'authError',
      retryable: false,
    };
    await expect(client.listChildren('parent')).rejects.toMatchObject(expected);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('cria pasta com pai e propriedades privadas do aplicativo', async () => {
    const captured: HttpRequest[] = [];
    const transport: HttpTransport = {
      request: (request) => {
        captured.push(request);
        return Promise.resolve(
          response(200, {
            ...file('folder', 'vault'),
            mimeType: 'application/vnd.google-apps.folder',
            appProperties: { vaultId: 'vault-1' },
          }),
        );
      },
    };
    const client = new DriveClient(transport, tokenProvider(), retryPolicy());

    const folder = await client.createFolder({
      name: 'vault',
      parentId: 'root-id',
      appProperties: { vaultId: 'vault-1' },
    });

    expect(folder.id).toBe('folder');
    expect(captured[0]?.method).toBe('POST');
    const body = captured[0]?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') {
      throw new Error('Corpo JSON não encontrado.');
    }
    expect(JSON.parse(body)).toMatchObject({
      name: 'vault',
      parents: ['root-id'],
      appProperties: { vaultId: 'vault-1' },
    });
  });

  it('rejeita resposta com metadados incompletos', async () => {
    const transport: HttpTransport = {
      request: () => Promise.resolve(response(200, { files: [{ name: 'sem-id' }] })),
    };
    const client = new DriveClient(transport, tokenProvider(), retryPolicy());

    await expect(client.listChildren('parent')).rejects.toThrow('Metadados inválidos');
  });

  it('usa multipart sem Content-Range para arquivos pequenos', async () => {
    const requests: HttpRequest[] = [];
    const transport: HttpTransport = {
      request: (request) => {
        requests.push(request);
        return Promise.resolve(response(200, file('small-upload', 'nota.md')));
      },
    };
    const client = new DriveClient(transport, tokenProvider(), retryPolicy());

    const uploaded = await client.uploadFile({
      name: 'nota.md',
      parentId: 'vault-folder',
      mimeType: 'text/markdown',
      data: new TextEncoder().encode('conteúdo').buffer,
      appProperties: { vaultId: 'vault-1' },
    });

    expect(uploaded.id).toBe('small-upload');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain('uploadType=multipart');
    expect(requests[0]?.headers?.['Content-Range']).toBeUndefined();
    expect(requests[0]?.headers?.['Content-Type']).toContain('multipart/related; boundary=');
    const body = requests[0]?.body;
    expect(body).toBeInstanceOf(ArrayBuffer);
    if (!(body instanceof ArrayBuffer)) throw new Error('Corpo multipart ausente.');
    const decoded = new TextDecoder().decode(body);
    expect(decoded).toContain('"parents":["vault-folder"]');
    expect(decoded).toContain('conteúdo');
  });

  it('faz upload retomável em blocos e não envia o bearer para a URL da sessão', async () => {
    const requests: HttpRequest[] = [];
    const sessionUrl = 'https://www.googleapis.com/upload/drive/v3/session-id';
    const transport: HttpTransport = {
      request: (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return Promise.resolve(response(200, {}, { Location: sessionUrl }));
        }
        if (requests.length === 2) {
          return Promise.resolve(response(308, {}, { Range: 'bytes=0-262143' }));
        }
        return Promise.resolve(response(200, file('uploaded')));
      },
    };
    const client = new DriveClient(transport, tokenProvider(), retryPolicy());
    const data = new ArrayBuffer(300 * 1024);

    const uploaded = await client.uploadResumable({
      name: 'grande.bin',
      parentId: 'vault-folder',
      mimeType: 'application/octet-stream',
      data,
      chunkSizeBytes: 256 * 1024,
    });

    expect(uploaded.id).toBe('uploaded');
    expect(requests).toHaveLength(3);
    expect(requests[0]?.headers?.Authorization).toBe('Bearer token-secreto');
    expect(requests[1]?.headers?.Authorization).toBeUndefined();
    expect(requests[1]?.headers?.['Content-Length']).toBeUndefined();
    expect(requests[1]?.headers?.['Content-Range']).toBe('bytes 0-262143/307200');
    expect(requests[2]?.headers?.['Content-Range']).toBe('bytes 262144-307199/307200');
  });

  it('rejeita URL de sessão externa antes de enviar conteúdo', async () => {
    const request = vi
      .fn<HttpTransport['request']>()
      .mockResolvedValue(response(200, {}, { Location: 'https://malicioso.example/upload' }));
    const client = new DriveClient({ request }, tokenProvider(), retryPolicy());

    await expect(
      client.uploadResumable({
        name: 'segredo.md',
        parentId: 'vault-folder',
        mimeType: 'text/markdown',
        data: new ArrayBuffer(10),
      }),
    ).rejects.toThrow('sessão de upload confiável');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
