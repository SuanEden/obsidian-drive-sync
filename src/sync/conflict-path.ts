import { assertVaultRelativePath } from '../domain/vault-path';

export function createConflictPath(
  originalPath: string,
  occurredAt: Date,
  deviceName: string,
  existingPaths: ReadonlySet<string> = new Set(),
): string {
  const safeOriginal = assertVaultRelativePath(originalPath);
  const separator = safeOriginal.lastIndexOf('/');
  const directory = separator === -1 ? '' : safeOriginal.slice(0, separator + 1);
  const fileName = separator === -1 ? safeOriginal : safeOriginal.slice(separator + 1);
  const extensionIndex = fileName.lastIndexOf('.');
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? fileName.slice(0, extensionIndex) : fileName;
  const extension = hasExtension ? fileName.slice(extensionIndex) : '';
  const device = sanitizeDeviceName(deviceName);
  const timestamp = formatTimestamp(occurredAt);
  const base = `${directory}${stem} (conflito ${timestamp} ${device})`;

  for (let suffix = 1; suffix <= 9999; suffix += 1) {
    const candidate = `${base}${suffix === 1 ? '' : ` ${suffix}`}${extension}`;
    assertVaultRelativePath(candidate);
    if (!existingPaths.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('Não foi possível criar um nome livre para a cópia de conflito.');
}

function sanitizeDeviceName(value: string): string {
  const sanitized = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return character === '/' || character === '\\' || code <= 31 || code === 127
        ? '-'
        : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return sanitized.length === 0 ? 'aparelho' : sanitized;
}

function formatTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('A data do conflito é inválida.');
  }
  return date.toISOString().replace('T', ' ').slice(0, 19).replace(/:/gu, '-');
}
