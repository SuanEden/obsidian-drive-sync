import { requestUrl } from 'obsidian';

import { FetchHttpTransport, isGoogleResumableUploadRequest } from './fetch-http-transport';
import type { HttpRequest, HttpResponse, HttpTransport } from './http-transport';
import { parseOptionalJson } from './http-response';

export class ObsidianHttpTransport implements HttpTransport {
  private readonly fetchTransport = new FetchHttpTransport();

  async request(request: HttpRequest): Promise<HttpResponse> {
    // Electron's net/requestUrl rejects binary PUT requests with Content-Range on
    // some Linux/Flatpak builds. The Google resumable session supports fetch and
    // is already restricted to a trusted HTTPS googleapis.com upload endpoint.
    if (isGoogleResumableUploadRequest(request)) {
      return this.fetchTransport.request(request);
    }

    const response = await requestUrl({
      url: request.url,
      method: request.method,
      headers: request.headers === undefined ? undefined : { ...request.headers },
      body: request.body,
      throw: false,
    });
    const json = parseOptionalJson(response.text);

    return {
      status: response.status,
      headers: response.headers,
      json,
      text: response.text,
      arrayBuffer: response.arrayBuffer,
    };
  }
}
