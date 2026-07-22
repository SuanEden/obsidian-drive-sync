import { describe, expect, it, vi } from 'vitest';

import {
  FetchHttpTransport,
  isGoogleResumableUploadRequest,
} from '../src/drive/fetch-http-transport';
import type { HttpRequest } from '../src/drive/http-transport';

describe('FetchHttpTransport', () => {
  it('preserva corpo binário, Content-Range e resposta JSON', async () => {
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"id":"arquivo"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', Range: 'bytes=0-9' },
      }),
    );
    const transport = new FetchHttpTransport(fetchFunction);
    const body = new Uint8Array([1, 2, 3]).buffer;

    const response = await transport.request({
      url: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=seguro',
      method: 'PUT',
      headers: { 'Content-Range': 'bytes 0-2/3' },
      body,
    });

    expect(fetchFunction).toHaveBeenCalledWith(
      'https://www.googleapis.com/upload/drive/v3/files?upload_id=seguro',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Range': 'bytes 0-2/3' },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ id: 'arquivo' });
    expect(response.headers.range).toBe('bytes=0-9');
  });
});

describe('isGoogleResumableUploadRequest', () => {
  const request = (url: string, method: HttpRequest['method'] = 'PUT'): HttpRequest => ({
    url,
    method,
  });

  it('aceita somente PUT HTTPS para o endpoint de upload do Google', () => {
    expect(
      isGoogleResumableUploadRequest(
        request('https://www.googleapis.com/upload/drive/v3/files?upload_id=abc'),
      ),
    ).toBe(true);
    expect(
      isGoogleResumableUploadRequest(
        request('https://content.googleapis.com/upload/drive/v3/files?upload_id=abc'),
      ),
    ).toBe(true);
    expect(
      isGoogleResumableUploadRequest(
        request('https://www.googleapis.com/upload/drive/v3/files?upload_id=abc', 'POST'),
      ),
    ).toBe(false);
    expect(
      isGoogleResumableUploadRequest(
        request('https://www.googleapis.com.evil.example/upload/drive/v3/files'),
      ),
    ).toBe(false);
    expect(
      isGoogleResumableUploadRequest(request('http://www.googleapis.com/upload/drive/v3/files')),
    ).toBe(false);
  });
});
