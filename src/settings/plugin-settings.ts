export type InitialSyncMode = 'upload-local' | 'download-remote' | 'merge';

export interface DriveSyncSettings {
  deviceName: string;
  automaticSyncIntervalMinutes: number;
  ignoredPaths: string[];
  remoteVaultId: string | null;
  remoteVaultMarkerId: string | null;
  initialSyncMode: InitialSyncMode | null;
  initialSyncCompletedAt: string | null;
  oauthWorkerUrl: string;
}

export const SAFE_DEVELOPMENT_IGNORED_PATHS = ['node_modules/', '.git/', 'coverage/'] as const;
export const DEFAULT_OAUTH_WORKER_URL = 'https://drive-sync-oauth.suan-obsidian-sync.workers.dev';

const PORTABLE_IGNORED_PATHS = [
  '.trash/',
  ...SAFE_DEVELOPMENT_IGNORED_PATHS,
  '*.tmp',
  '*.swp',
  '*.~lock.*',
  '*conflicted copy*',
];

export function createDefaultSettings(configDir: string, pluginId: string): DriveSyncSettings {
  const pluginDataDir = `${configDir}/plugins/${pluginId}`;
  return {
    deviceName: 'Este aparelho',
    automaticSyncIntervalMinutes: 15,
    ignoredPaths: [
      `${configDir}/workspace.json`,
      `${configDir}/workspace-mobile.json`,
      `${pluginDataDir}/`,
      ...PORTABLE_IGNORED_PATHS,
    ],
    remoteVaultId: null,
    remoteVaultMarkerId: null,
    initialSyncMode: null,
    initialSyncCompletedAt: null,
    oauthWorkerUrl: DEFAULT_OAUTH_WORKER_URL,
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
    remoteVaultMarkerId: readNonEmptyString(data.remoteVaultMarkerId),
    initialSyncMode: readInitialSyncMode(data.initialSyncMode),
    initialSyncCompletedAt: readIsoDate(data.initialSyncCompletedAt),
    oauthWorkerUrl: readHttpsUrl(data.oauthWorkerUrl) ?? defaults.oauthWorkerUrl,
  };
}

function readIsoDate(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function readInitialSyncMode(value: unknown): InitialSyncMode | null {
  return value === 'upload-local' || value === 'download-remote' || value === 'merge'
    ? value
    : null;
}

function readHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function addSafeDevelopmentIgnores(settings: DriveSyncSettings): DriveSyncSettings {
  const pluginDataDirectory = pluginDirectoryFromSettings(settings);
  const required = [pluginDataDirectory, ...SAFE_DEVELOPMENT_IGNORED_PATHS];
  return addMissingIgnores(settings, required);
}

export function addRequiredPluginIgnore(settings: DriveSyncSettings): DriveSyncSettings {
  return addMissingIgnores(settings, [pluginDirectoryFromSettings(settings)]);
}

function addMissingIgnores(
  settings: DriveSyncSettings,
  required: readonly string[],
): DriveSyncSettings {
  const existing = new Set(settings.ignoredPaths.map((path) => path.toLocaleLowerCase()));
  const missing = required.filter((path) => !existing.has(path.toLocaleLowerCase()));

  return missing.length === 0
    ? settings
    : { ...settings, ignoredPaths: [...settings.ignoredPaths, ...missing] };
}

function pluginDirectoryFromSettings(settings: DriveSyncSettings): string {
  const completeDirectory = settings.ignoredPaths.find((path) =>
    path.endsWith('/plugins/obsidian-drive-sync/'),
  );
  if (completeDirectory !== undefined) return completeDirectory;
  const internalPath = settings.ignoredPaths.find((path) =>
    path.endsWith('/plugins/obsidian-drive-sync/data.json'),
  );
  return internalPath?.slice(0, -'data.json'.length) ?? '.obsidian/plugins/obsidian-drive-sync/';
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
