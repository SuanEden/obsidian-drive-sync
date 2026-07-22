import type { HttpRequest, HttpResponse, HttpTransport } from './http-transport';
import { parseOptionalJson } from './http-response';

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class FetchHttpTransport implements HttpTransport {
  constructor(private readonly fetchFunction: FetchFunction = globalThis.fetch.bind(globalThis)) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const response = await this.fetchFunction(request.url, {
      method: request.method,
      headers: request.headers === undefined ? undefined : { ...request.headers },
      body: request.body,
    });
    const arrayBuffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });

    return {
      status: response.status,
      headers,
      json: parseOptionalJson(text),
      text,
      arrayBuffer,
    };
  }
}

export function isGoogleResumableUploadRequest(request: HttpRequest): boolean {
  if (request.method !== 'PUT') return false;

  try {
    const url = new URL(request.url);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'www.googleapis.com' || url.hostname.endsWith('.googleapis.com')) &&
      url.pathname.startsWith('/upload/drive/')
    );
  } catch {
    return false;
  }
}
