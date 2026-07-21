export interface DriveSyncSettings {
  deviceName: string;
  automaticSyncIntervalMinutes: number;
  ignoredPaths: string[];
  remoteVaultId: string | null;
}

const PORTABLE_IGNORED_PATHS = ['.trash/', '*.tmp', '*.swp', '*.~lock.*', '*conflicted copy*'];

export function createDefaultSettings(configDir: string, pluginId: string): DriveSyncSettings {
  const pluginDataDir = `${configDir}/plugins/${pluginId}`;
  return {
    deviceName: 'Este aparelho',
    automaticSyncIntervalMinutes: 15,
    ignoredPaths: [
      `${configDir}/workspace.json`,
      `${configDir}/workspace-mobile.json`,
      `${pluginDataDir}/data.json`,
      `${pluginDataDir}/sync-data/`,
      ...PORTABLE_IGNORED_PATHS,
    ],
    remoteVaultId: null,
  };
}

export const DEFAULT_SETTINGS = createDefaultSettings('.obsidian', 'obsidian-drive-sync');

export function parseSettings(
  data: unknown,
  defaults: DriveSyncSettings = DEFAULT_SETTINGS,
): DriveSyncSettings {
  if (!isRecord(data)) {
    return { ...defaults, ignoredPaths: [...defaults.ignoredPaths] };
  }

  return {
    deviceName: readNonEmptyString(data.deviceName) ?? defaults.deviceName,
    automaticSyncIntervalMinutes:
      readPositiveNumber(data.automaticSyncIntervalMinutes) ??
      defaults.automaticSyncIntervalMinutes,
    ignoredPaths: readStringArray(data.ignoredPaths) ?? [...defaults.ignoredPaths],
    remoteVaultId: readNonEmptyString(data.remoteVaultId),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return null;
  }

  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}
