import { describe, expect, it, vi } from 'vitest';

import {
  GoogleOAuthService,
  type AuthSecretStorage,
  type GoogleOAuthTokens,
  type OAuthRefreshRequester,
} from '../src/auth/google-oauth';
import { decodeBase64Url, encodeBase64Url } from '../src/auth/oauth-encoding';

class MemorySecrets implements AuthSecretStorage {
  readonly values = new Map<string, string>();

  setSecret(id: string, secret: string): void {
    this.values.set(id, secret);
  }

  getSecret(id: string): string | null {
    return this.values.get(id) ?? null;
  }
}

const TOKENS: GoogleOAuthTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 1_800_000_000_000,
  scope: 'openid email https://www.googleapis.com/auth/drive.file',
  email: 'silveirasuan@gmail.com',
};

describe('GoogleOAuthService', () => {
  it('cria uma autorização HTTPS com estado e chave pública temporários', async () => {
    const secrets = new MemorySecrets();
    let openedUrl = '';
    const service = new GoogleOAuthService(secrets, (url) => (openedUrl = url));

    await service.beginAuthorization('https://oauth.example.workers.dev');

    const url = new URL(openedUrl);
    expect(url.origin).toBe('https://oauth.example.workers.dev');
    expect(url.pathname).toBe('/oauth/start');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(decodeBase64Url(url.searchParams.get('public_key') ?? '')).toHaveLength(65);
    expect([...secrets.values.values()].some((value) => value.includes('privateKey'))).toBe(true);
  });

  it('recusa servidor OAuth sem HTTPS', async () => {
    const service = new GoogleOAuthService(new MemorySecrets(), () => undefined);
    await expect(service.beginAuthorization('http://localhost:8787')).rejects.toThrow('HTTPS');
  });

  it('descriptografa a resposta vinculada ao estado e guarda os tokens no SecretStorage', async () => {
    const secrets = new MemorySecrets();
    let openedUrl = '';
    const service = new GoogleOAuthService(secrets, (url) => (openedUrl = url));
    await service.beginAuthorization('https://oauth.example.workers.dev');
    const startUrl = new URL(openedUrl);
    const response = await encryptLikeWorker(TOKENS, startUrl.searchParams.get('public_key') ?? '');

    const result = await service.finishAuthorization({
      action: 'drive-sync-auth',
      state: startUrl.searchParams.get('state') ?? '',
      ...response,
    });

    expect(result).toEqual(TOKENS);
    expect(service.getTokens()).toEqual(TOKENS);
  });

  it('recusa callback com estado de outro aparelho', async () => {
    const service = new GoogleOAuthService(new MemorySecrets(), () => undefined);
    await service.beginAuthorization('https://oauth.example.workers.dev');

    await expect(
      service.finishAuthorization({ action: 'drive-sync-auth', state: 'estado-forjado' }),
    ).rejects.toThrow('não corresponde');
  });

  it('remove tokens locais ao desvincular', () => {
    const secrets = new MemorySecrets();
    const service = new GoogleOAuthService(secrets, () => undefined);
    secrets.setSecret('obsidian-drive-sync-google-tokens', JSON.stringify(TOKENS));

    service.disconnect();

    expect(service.getTokens()).toBeNull();
  });

  it('renova e persiste uma sessão expirada sem novo login', async () => {
    const secrets = new MemorySecrets();
    secrets.setSecret(
      'obsidian-drive-sync-google-tokens',
      JSON.stringify({ ...TOKENS, expiresAt: Date.now() - 1 }),
    );
    const refresh: OAuthRefreshRequester['refresh'] = (workerUrl, refreshToken) => {
      expect(workerUrl).toBe('https://oauth.example.workers.dev/');
      expect(refreshToken).toBe('refresh-token');
      return Promise.resolve({
        accessToken: 'access-token-renovado',
        expiresAt: Date.now() + 3_600_000,
        email: TOKENS.email,
      });
    };
    const service = new GoogleOAuthService(secrets, () => undefined, { refresh });

    await expect(service.getValidAccessToken('https://oauth.example.workers.dev')).resolves.toBe(
      'access-token-renovado',
    );
    expect(service.getTokens()?.accessToken).toBe('access-token-renovado');
  });

  it('compartilha uma única renovação entre chamadas simultâneas', async () => {
    const secrets = new MemorySecrets();
    secrets.setSecret(
      'obsidian-drive-sync-google-tokens',
      JSON.stringify({ ...TOKENS, expiresAt: Date.now() - 1 }),
    );
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const refresh = vi.fn<OAuthRefreshRequester['refresh']>(async () => {
      await pending;
      return {
        accessToken: 'token-compartilhado',
        expiresAt: Date.now() + 3_600_000,
        email: TOKENS.email,
      };
    });
    const service = new GoogleOAuthService(secrets, () => undefined, { refresh });

    const first = service.getValidAccessToken('https://oauth.example.workers.dev');
    const second = service.getValidAccessToken('https://oauth.example.workers.dev');
    release?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      'token-compartilhado',
      'token-compartilhado',
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

async function encryptLikeWorker(value: unknown, pluginPublicKey: string) {
  const pluginKey = await crypto.subtle.importKey(
    'raw',
    decodeBase64Url(pluginPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: pluginKey },
    pair.privateKey,
    256,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode('drive-sync-oauth-v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const payload = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  const serverPublicKey = await crypto.subtle.exportKey('raw', pair.publicKey);
  if (!(serverPublicKey instanceof ArrayBuffer)) throw new Error('Chave pública inválida.');
  return {
    server_key: encodeBase64Url(serverPublicKey),
    salt: encodeBase64Url(salt),
    iv: encodeBase64Url(iv),
    payload: encodeBase64Url(payload),
  };
}
