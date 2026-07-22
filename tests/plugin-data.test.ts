import { describe, expect, it } from 'vitest';

import { EMPTY_INVENTORY_STATE, type InventorySnapshot } from '../src/domain/inventory';
import { isCurrentPluginData, parsePluginData, recordInventory } from '../src/settings/plugin-data';
import { DEFAULT_SETTINGS } from '../src/settings/plugin-settings';

const SNAPSHOT: InventorySnapshot = {
  summary: {
    scannedAt: '2026-07-21T12:00:00.000Z',
    fileCount: 1,
    totalBytes: 3,
    ignoredCount: 2,
    failedCount: 0,
  },
  entries: [
    {
      path: 'nota.md',
      size: 3,
      modifiedAt: '2026-07-21T11:00:00.000Z',
      hash: 'sha256:abc',
    },
  ],
  failures: [],
};

describe('parsePluginData', () => {
  it('migra silenciosamente o formato plano da fase anterior', () => {
    const data = parsePluginData({ ...DEFAULT_SETTINGS, deviceName: 'Linux' }, DEFAULT_SETTINGS);

    expect(data.settings.deviceName).toBe('Linux');
    expect(data.inventory).toEqual(EMPTY_INVENTORY_STATE);
  });

  it('descarta inventário inválido sem perder configurações', () => {
    const data = parsePluginData(
      { schemaVersion: 1, settings: DEFAULT_SETTINGS, inventory: { latest: 'inválido' } },
      DEFAULT_SETTINGS,
    );

    expect(data.settings).toEqual(DEFAULT_SETTINGS);
    expect(data.inventory).toEqual(EMPTY_INVENTORY_STATE);
  });

  it('migra schema 1, acrescenta exclusões seguras e preserva o inventário', () => {
    const legacySettings = { ...DEFAULT_SETTINGS, ignoredPaths: ['*.tmp'] };
    const data = parsePluginData(
      {
        schemaVersion: 1,
        settings: legacySettings,
        inventory: { latest: SNAPSHOT, history: [SNAPSHOT.summary] },
      },
      DEFAULT_SETTINGS,
    );

    expect(data.schemaVersion).toBe(2);
    expect(data.settings.ignoredPaths).toEqual([
      '*.tmp',
      '.obsidian/plugins/obsidian-drive-sync/',
      'node_modules/',
      '.git/',
      'coverage/',
    ]);
    expect(data.inventory.latest).toEqual(SNAPSHOT);
  });

  it('respeita remoções feitas depois da migração para schema 2', () => {
    const data = parsePluginData(
      {
        schemaVersion: 2,
        settings: { ...DEFAULT_SETTINGS, ignoredPaths: ['*.tmp'] },
        inventory: EMPTY_INVENTORY_STATE,
      },
      DEFAULT_SETTINGS,
    );

    expect(data.settings.ignoredPaths).toEqual(['*.tmp', '.obsidian/plugins/obsidian-drive-sync/']);
    expect(isCurrentPluginData(data)).toBe(true);
  });
});

describe('recordInventory', () => {
  it('mantém o snapshot mais recente e limita o histórico', () => {
    const state = recordInventory(
      { latest: null, history: Array.from({ length: 20 }, () => SNAPSHOT.summary) },
      SNAPSHOT,
    );

    expect(state.latest).toBe(SNAPSHOT);
    expect(state.history).toHaveLength(20);
    expect(state.history[0]).toBe(SNAPSHOT.summary);
  });
});
