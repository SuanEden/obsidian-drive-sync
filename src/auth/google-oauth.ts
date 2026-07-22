import type { ObsidianProtocolData } from 'obsidian';

import { decodeBase64Url, encodeBase64Url } from './oauth-encoding';

const TOKEN_SECRET_ID = 'obsidian-drive-sync-google-tokens';
const PENDING_SECRET_ID = 'obsidian-drive-sync-oauth-pending';
const OAUTH_SESSION_MAX_AGE_MS = 15 * 60_000;
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope: string;
  readonly email: string;
}

export interface AuthSecretStorage {
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
}

export interface OAuthRefreshRequester {
  refresh(
    workerUrl: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: number; email: string }>;
}

interface PendingAuthorization {
  readonly state: string;
  readonly privateKey: JsonWebKey;
  readonly createdAt: number;
}

export class GoogleOAuthService {
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly secrets: AuthSecretStorage,
    private readonly openExternal: (url: string) => void,
    private readonly refreshRequester?: OAuthRefreshRequester,
  ) {}

  getTokens(): GoogleOAuthTokens | null {
    return parseTokens(this.secrets.getSecret(TOKEN_SECRET_ID));
  }

  async getValidAccessToken(workerUrl: string): Promise<string> {
    const tokens = this.getTokens();
    if (tokens === null) throw new Error('Conecte novamente sua conta Google.');
    if (tokens.expiresAt > Date.now() + 2 * 60_000) return tokens.accessToken;
    if (this.refreshRequester === undefined) {
      throw new Error('A renovação da sessão Google não está disponível.');
    }

    this.refreshInFlight ??= this.refreshTokens(workerUrl, tokens).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  async beginAuthorization(workerUrl: string): Promise<void> {
    const baseUrl = parseWorkerUrl(workerUrl);
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const [publicKey, privateKey] = await Promise.all([
      crypto.subtle.exportKey('raw', pair.publicKey),
      crypto.subtle.exportKey('jwk', pair.privateKey),
    ]);
    if (!(publicKey instanceof ArrayBuffer)) {
      throw new Error('Não foi possível gerar a chave temporária de autorização.');
    }

    const state = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const pending: PendingAuthorization = { state, privateKey, createdAt: Date.now() };
    this.secrets.setSecret(PENDING_SECRET_ID, JSON.stringify(pending));

    const authorizationUrl = new URL('/oauth/start', baseUrl);
    authorizationUrl.search = new URLSearchParams({
      state,
      public_key: encodeBase64Url(publicKey),
    }).toString();
    this.openExternal(authorizationUrl.toString());
  }

  async finishAuthorization(data: ObsidianProtocolData): Promise<GoogleOAuthTokens> {
    const pending = parsePendingAuthorization(this.secrets.getSecret(PENDING_SECRET_ID));
    if (pending === null) {
      throw new Error('Nenhuma autorização Google está pendente neste aparelho.');
    }
    if (Date.now() - pending.createdAt > OAUTH_SESSION_MAX_AGE_MS) {
      this.clearPendingAuthorization();
      throw new Error('A autorização expirou. Inicie o acesso ao Google novamente.');
    }
    if (data.state !== pending.state) {
      throw new Error('O estado da autorização não corresponde a este aparelho.');
    }

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      pending.privateKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const serverPublicKey = await crypto.subtle.importKey(
      'raw',
      decodeRequired(data, 'server_key'),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: serverPublicKey },
      privateKey,
      256,
    );
    const keyMaterial = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
      'deriveKey',
    ]);
    const aesKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: decodeRequired(data, 'salt'),
        info: new TextEncoder().encode('drive-sync-oauth-v1'),
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeRequired(data, 'iv') },
      aesKey,
      decodeRequired(data, 'payload'),
    );
    const tokens = parseTokens(new TextDecoder().decode(plaintext));
    if (tokens === null) {
      throw new Error('O servidor OAuth retornou credenciais inválidas.');
    }

    this.secrets.setSecret(TOKEN_SECRET_ID, JSON.stringify(tokens));
    this.clearPendingAuthorization();
    return tokens;
  }

  disconnect(): void {
    this.secrets.setSecret(TOKEN_SECRET_ID, '');
    this.clearPendingAuthorization();
  }

  private clearPendingAuthorization(): void {
    this.secrets.setSecret(PENDING_SECRET_ID, '');
  }

  private async refreshTokens(workerUrl: string, current: GoogleOAuthTokens): Promise<string> {
    const refreshed = await this.refreshRequester!.refresh(
      parseWorkerUrl(workerUrl).toString(),
      current.refreshToken,
    );
    if (
      refreshed.accessToken.length === 0 ||
      !Number.isFinite(refreshed.expiresAt) ||
      refreshed.expiresAt <= Date.now() ||
      refreshed.email.toLocaleLowerCase() !== current.email.toLocaleLowerCase()
    ) {
      throw new Error('O servidor OAuth retornou uma renovação inválida.');
    }
    const tokens: GoogleOAuthTokens = {
      ...current,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };
    this.secrets.setSecret(TOKEN_SECRET_ID, JSON.stringify(tokens));
    return tokens.accessToken;
  }
}

function parseWorkerUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('O endereço do servidor OAuth não é válido.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('O servidor OAuth deve usar HTTPS.');
  }
  return url;
}

function decodeRequired(data: ObsidianProtocolData, key: string): Uint8Array<ArrayBuffer> {
  const value = data[key];
  if (value === undefined || value === 'true') {
    throw new Error(`Resposta OAuth sem o campo ${key}.`);
  }
  return decodeBase64Url(value);
}

function parsePendingAuthorization(value: string | null): PendingAuthorization | null {
  const parsed = parseJsonRecord(value);
  if (
    parsed === null ||
    typeof parsed.state !== 'string' ||
    !isRecord(parsed.privateKey) ||
    typeof parsed.createdAt !== 'number'
  ) {
    return null;
  }
  return {
    state: parsed.state,
    privateKey: parsed.privateKey,
    createdAt: parsed.createdAt,
  };
}

function parseTokens(value: string | null): GoogleOAuthTokens | null {
  const parsed = parseJsonRecord(value);
  if (
    parsed === null ||
    typeof parsed.accessToken !== 'string' ||
    parsed.accessToken.length === 0 ||
    typeof parsed.refreshToken !== 'string' ||
    parsed.refreshToken.length === 0 ||
    typeof parsed.expiresAt !== 'number' ||
    !Number.isFinite(parsed.expiresAt) ||
    typeof parsed.scope !== 'string' ||
    !parsed.scope.split(' ').includes(REQUIRED_SCOPE) ||
    typeof parsed.email !== 'string' ||
    parsed.email.length === 0
  ) {
    return null;
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
    scope: parsed.scope,
    email: parsed.email,
  };
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (value === null || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
