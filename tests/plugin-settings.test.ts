import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OAUTH_WORKER_URL,
  DEFAULT_SETTINGS,
  createDefaultSettings,
  parseSettings,
} from '../src/settings/plugin-settings';

describe('parseSettings', () => {
  it('usa padrões seguros para dados ausentes ou inválidos', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ automaticSyncIntervalMinutes: -1 })).toEqual(DEFAULT_SETTINGS);
  });

  it('preserva configurações válidas e normaliza texto', () => {
    expect(
      parseSettings({
        deviceName: '  Celular  ',
        automaticSyncIntervalMinutes: 30,
        ignoredPaths: [' notas/tmp/ ', '', '*.swp'],
        remoteVaultId: ' abc123 ',
      }),
    ).toEqual({
      deviceName: 'Celular',
      automaticSyncIntervalMinutes: 30,
      ignoredPaths: ['notas/tmp/', '*.swp'],
      remoteVaultId: 'abc123',
      remoteVaultMarkerId: null,
      initialSyncMode: null,
      initialSyncCompletedAt: null,
      oauthWorkerUrl: DEFAULT_OAUTH_WORKER_URL,
    });
  });

  it('aceita apenas a origem HTTPS do servidor OAuth', () => {
    expect(
      parseSettings({ oauthWorkerUrl: 'https://oauth.example.dev/caminho' }).oauthWorkerUrl,
    ).toBe('https://oauth.example.dev');
    expect(parseSettings({ oauthWorkerUrl: 'http://localhost:8787' }).oauthWorkerUrl).toBe(
      DEFAULT_OAUTH_WORKER_URL,
    );
  });

  it('ignora os dados locais do próprio plugin por padrão', () => {
    const settings = createDefaultSettings('.configuracao', 'drive-sync');

    expect(settings.ignoredPaths).toContain('.configuracao/plugins/drive-sync/');
    expect(settings.ignoredPaths).toContain('.configuracao/workspace.json');
    expect(settings.ignoredPaths).toContain('node_modules/');
    expect(settings.ignoredPaths).toContain('.git/');
    expect(settings.ignoredPaths).toContain('coverage/');
  });
});
