import { describe, expect, it } from 'vitest';

import {
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
    });
  });

  it('ignora os dados locais do próprio plugin por padrão', () => {
    const settings = createDefaultSettings('.configuracao', 'drive-sync');

    expect(settings.ignoredPaths).toContain('.configuracao/plugins/drive-sync/data.json');
    expect(settings.ignoredPaths).toContain('.configuracao/workspace.json');
  });
});
