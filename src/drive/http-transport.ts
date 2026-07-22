export interface HttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | ArrayBuffer;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly json: unknown;
  readonly text: string;
  readonly arrayBuffer: ArrayBuffer;
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}
