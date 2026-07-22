import { decodeBase64Url, decodeJson, encodeBase64Url, encodeJson } from './encoding';

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  OAUTH_STATE_SECRET: string;
  ALLOWED_GOOGLE_EMAIL: string;
}

interface StatePayload {
  pluginState: string;
  pluginPublicKey: string;
  expiresAt: number;
}

interface GoogleTokens {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  id_token: string;
}

interface RefreshedGoogleTokens {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') return Response.json({ ok: true });
      if (request.method === 'GET' && url.pathname === '/oauth/start')
        return startAuthorization(url, env);
      if (request.method === 'GET' && url.pathname === '/oauth/callback')
        return finishAuthorization(url, env);
      if (request.method === 'POST' && url.pathname === '/oauth/refresh')
        return refreshAuthorization(request, env);
      return text('Rota não encontrada.', 404);
    } catch (error) {
      return text(error instanceof Error ? error.message : 'Falha inesperada.', 400);
    }
  },
} satisfies ExportedHandler<Env>;

async function startAuthorization(url: URL, env: Env): Promise<Response> {
  requireOAuthConfiguration(env);
  const pluginState = requiredParameter(url, 'state');
  const pluginPublicKey = requiredParameter(url, 'public_key');
  if (decodeBase64Url(pluginPublicKey).byteLength !== 65)
    throw new Error('Chave pública inválida.');

  const state = await signState(
    { pluginState, pluginPublicKey, expiresAt: Date.now() + 10 * 60_000 },
    env.OAUTH_STATE_SECRET,
  );
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorization.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString();
  return Response.redirect(authorization.toString(), 302);
}

async function refreshAuthorization(request: Request, env: Env): Promise<Response> {
  requireOAuthConfiguration(env);
  const value: unknown = await request.json();
  if (!isRecord(value) || typeof value.refreshToken !== 'string' || value.refreshToken.length === 0)
    return Response.json({ error: 'Refresh token ausente.' }, { status: 400 });

  const tokens = await refreshAccessToken(value.refreshToken, env);
  const identity = await fetchGoogleIdentity(tokens.access_token);
  if (identity.email.toLocaleLowerCase() !== env.ALLOWED_GOOGLE_EMAIL.toLocaleLowerCase()) {
    return Response.json({ error: 'Esta conta Google não está autorizada.' }, { status: 403 });
  }
  return Response.json({
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    email: identity.email,
  });
}

async function finishAuthorization(url: URL, env: Env): Promise<Response> {
  requireOAuthConfiguration(env);
  const signedState = requiredParameter(url, 'state');
  const state = await verifyState(signedState, env.OAUTH_STATE_SECRET);
  if (state.expiresAt < Date.now()) throw new Error('A autorização expirou. Tente novamente.');
  const oauthError = url.searchParams.get('error');
  if (oauthError !== null) throw new Error(`Autorização recusada: ${oauthError}`);

  const tokens = await exchangeCode(requiredParameter(url, 'code'), env);
  const identity = await verifyIdToken(tokens.id_token, env.GOOGLE_CLIENT_ID);
  if (identity.email.toLocaleLowerCase() !== env.ALLOWED_GOOGLE_EMAIL.toLocaleLowerCase()) {
    await revokeToken(tokens.refresh_token);
    throw new Error('Esta conta Google não está autorizada para este serviço.');
  }

  const encrypted = await encryptForPlugin(
    {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
      email: identity.email,
    },
    state.pluginPublicKey,
  );
  const callback = new URL('obsidian://drive-sync-auth');
  callback.search = new URLSearchParams({
    state: state.pluginState,
    server_key: encrypted.serverPublicKey,
    salt: encrypted.salt,
    iv: encrypted.iv,
    payload: encrypted.payload,
  }).toString();
  return callbackPage(callback.toString());
}

function requireOAuthConfiguration(env: Env): void {
  const required: Array<keyof Env> = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'OAUTH_STATE_SECRET',
    'ALLOWED_GOOGLE_EMAIL',
  ];
  if (required.some((key) => typeof env[key] !== 'string' || env[key].length === 0)) {
    throw new Error('O serviço OAuth ainda não foi configurado.');
  }
}

async function exchangeCode(code: string, env: Env): Promise<GoogleTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isGoogleTokens(body))
    throw new Error('O Google não retornou tokens válidos.');
  return body;
}

async function refreshAccessToken(refreshToken: string, env: Env): Promise<RefreshedGoogleTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRefreshedGoogleTokens(body)) {
    throw new Error('A sessão Google não pôde ser renovada. Entre novamente.');
  }
  return body;
}

async function fetchGoogleIdentity(accessToken: string): Promise<{ email: string }> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.email !== 'string') {
    throw new Error('Não foi possível confirmar a conta Google renovada.');
  }
  return { email: body.email };
}

async function verifyIdToken(token: string, clientId: string): Promise<{ email: string }> {
  const parts = token.split('.');
  if (
    parts.length !== 3 ||
    parts[0] === undefined ||
    parts[1] === undefined ||
    parts[2] === undefined
  )
    throw new Error('ID token inválido.');
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!isRecord(header) || header.alg !== 'RS256' || typeof header.kid !== 'string')
    throw new Error('Cabeçalho do ID token inválido.');
  if (!isRecord(payload)) throw new Error('Conteúdo do ID token inválido.');

  const certificatesResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const certificates: unknown = await certificatesResponse.json();
  if (!isRecord(certificates) || !Array.isArray(certificates.keys))
    throw new Error('Não foi possível validar a assinatura Google.');
  const jwk = certificates.keys.find(
    (candidate) => isRecord(candidate) && candidate.kid === header.kid,
  );
  if (!isRecord(jwk)) throw new Error('Chave de assinatura Google não encontrada.');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk as unknown as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const issuerValid =
    payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  if (
    !verified ||
    !issuerValid ||
    payload.aud !== clientId ||
    typeof payload.exp !== 'number' ||
    payload.exp * 1000 <= Date.now() ||
    payload.email_verified !== true ||
    typeof payload.email !== 'string'
  ) {
    throw new Error('Identidade Google inválida ou expirada.');
  }
  return { email: payload.email };
}

async function encryptForPlugin(value: unknown, publicKeyValue: string) {
  const pluginKey = await crypto.subtle.importKey(
    'raw',
    decodeBase64Url(publicKeyValue),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: pluginKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0],
    pair.privateKey,
    256,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('drive-sync-oauth-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const payload = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  const serverPublicKey = await crypto.subtle.exportKey('raw', pair.publicKey);
  if (!(serverPublicKey instanceof ArrayBuffer)) throw new Error('Chave ECDH inválida.');
  return {
    serverPublicKey: encodeBase64Url(serverPublicKey),
    salt: encodeBase64Url(salt),
    iv: encodeBase64Url(iv),
    payload: encodeBase64Url(payload),
  };
}

async function signState(payload: StatePayload, secret: string): Promise<string> {
  const encoded = encodeJson(payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return `${encoded}.${encodeBase64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded)))}`;
}

async function verifyState(value: string, secret: string): Promise<StatePayload> {
  const [encoded, signature] = value.split('.');
  if (encoded === undefined || signature === undefined) throw new Error('Estado OAuth inválido.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(encoded),
  );
  if (!valid) throw new Error('Assinatura do estado OAuth inválida.');
  const payload = decodeJson(encoded);
  if (
    !isRecord(payload) ||
    typeof payload.pluginState !== 'string' ||
    typeof payload.pluginPublicKey !== 'string' ||
    typeof payload.expiresAt !== 'number'
  )
    throw new Error('Conteúdo do estado OAuth inválido.');
  return payload as unknown as StatePayload;
}

async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

function callbackPage(callback: string): Response {
  const safe = callback.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;');
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Drive Sync</title><p>Autorização concluída.</p><p><a href="${safe}">Voltar ao Obsidian</a></p>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    },
  );
}

function requiredParameter(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value.length === 0) throw new Error(`Parâmetro ausente: ${name}`);
  return value;
}

function isGoogleTokens(value: unknown): value is GoogleTokens {
  return (
    isRecord(value) &&
    typeof value.access_token === 'string' &&
    typeof value.refresh_token === 'string' &&
    typeof value.id_token === 'string' &&
    typeof value.expires_in === 'number' &&
    typeof value.scope === 'string' &&
    typeof value.token_type === 'string'
  );
}

function isRefreshedGoogleTokens(value: unknown): value is RefreshedGoogleTokens {
  return (
    isRecord(value) &&
    typeof value.access_token === 'string' &&
    typeof value.expires_in === 'number' &&
    typeof value.token_type === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
  });
}
