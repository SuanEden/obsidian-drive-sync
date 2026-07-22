import { requestUrl } from 'obsidian';

import type { OAuthRefreshRequester } from './google-oauth';

interface RefreshResponse {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly email: string;
}

export class ObsidianOAuthRefreshRequester implements OAuthRefreshRequester {
  async refresh(workerUrl: string, refreshToken: string): Promise<RefreshResponse> {
    const url = new URL('/oauth/refresh', workerUrl);
    const response = await requestUrl({
      url: url.toString(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ refreshToken }),
      throw: false,
    });
    const value: unknown = parseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(readError(value) ?? 'Não foi possível renovar a sessão Google.');
    }
    if (
      !isRecord(value) ||
      typeof value.accessToken !== 'string' ||
      typeof value.expiresAt !== 'number' ||
      typeof value.email !== 'string'
    ) {
      throw new Error('Resposta inválida ao renovar a sessão Google.');
    }
    return {
      accessToken: value.accessToken,
      expiresAt: value.expiresAt,
      email: value.email,
    };
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readError(value: unknown): string | null {
  return isRecord(value) && typeof value.error === 'string' ? value.error : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
