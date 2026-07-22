import {
  EMPTY_INVENTORY_STATE,
  type InventorySnapshot,
  type InventoryState,
  type InventorySummary,
} from '../domain/inventory';
import {
  addRequiredPluginIgnore,
  addSafeDevelopmentIgnores,
  parseSettings,
  type DriveSyncSettings,
} from './plugin-settings';

export interface PluginData {
  readonly schemaVersion: 2;
  readonly settings: DriveSyncSettings;
  readonly inventory: InventoryState;
}

export function parsePluginData(data: unknown, defaults: DriveSyncSettings): PluginData {
  if (!isRecord(data) || !('settings' in data)) {
    return {
      schemaVersion: 2,
      settings: addSafeDevelopmentIgnores(parseSettings(data, defaults)),
      inventory: EMPTY_INVENTORY_STATE,
    };
  }

  const parsedSettings = parseSettings(data.settings, defaults);
  const settings =
    data.schemaVersion === 2
      ? addRequiredPluginIgnore(parsedSettings)
      : addSafeDevelopmentIgnores(parsedSettings);
  return {
    schemaVersion: 2,
    settings,
    inventory: parseInventoryState(data.inventory),
  };
}

export function isCurrentPluginData(data: unknown): boolean {
  return isRecord(data) && data.schemaVersion === 2 && 'settings' in data;
}

export function recordInventory(
  state: InventoryState,
  snapshot: InventorySnapshot,
  historyLimit = 20,
): InventoryState {
  return {
    latest: snapshot,
    history: [snapshot.summary, ...state.history].slice(0, historyLimit),
  };
}

function parseInventoryState(data: unknown): InventoryState {
  if (!isRecord(data)) {
    return EMPTY_INVENTORY_STATE;
  }

  const latest = parseSnapshot(data.latest);
  const history = Array.isArray(data.history)
    ? data.history.flatMap((item) => {
        const summary = parseSummary(item);
        return summary === null ? [] : [summary];
      })
    : [];

  return { latest, history: history.slice(0, 20) };
}

function parseSnapshot(data: unknown): InventorySnapshot | null {
  if (!isRecord(data)) {
    return null;
  }

  const summary = parseSummary(data.summary);
  if (summary === null || !Array.isArray(data.entries) || !Array.isArray(data.failures)) {
    return null;
  }

  const entries = data.entries.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.path !== 'string' ||
      typeof item.size !== 'number' ||
      typeof item.modifiedAt !== 'string' ||
      typeof item.hash !== 'string'
    ) {
      return [];
    }
    return [{ path: item.path, size: item.size, modifiedAt: item.modifiedAt, hash: item.hash }];
  });
  const failures = data.failures.flatMap((item) => {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.message !== 'string') {
      return [];
    }
    return [{ path: item.path, message: item.message }];
  });

  return { summary, entries, failures };
}

function parseSummary(data: unknown): InventorySummary | null {
  if (
    !isRecord(data) ||
    typeof data.scannedAt !== 'string' ||
    !isNonNegativeNumber(data.fileCount) ||
    !isNonNegativeNumber(data.totalBytes) ||
    !isNonNegativeNumber(data.ignoredCount) ||
    !isNonNegativeNumber(data.failedCount)
  ) {
    return null;
  }

  return {
    scannedAt: data.scannedAt,
    fileCount: data.fileCount,
    totalBytes: data.totalBytes,
    ignoredCount: data.ignoredCount,
    failedCount: data.failedCount,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
