import type { DataAdapter, Stat } from 'obsidian';

import { shouldIgnoreVaultPath } from '../domain/ignore-pattern';
import type {
  InventoryEntry,
  InventoryFailure,
  InventoryProgress,
  InventorySnapshot,
} from '../domain/inventory';
import { validateVaultRelativePath } from '../domain/vault-path';
import { calculateSha256 } from './sha256';

export interface InventoryScanOptions {
  readonly ignoredPaths: readonly string[];
  readonly onProgress?: (progress: InventoryProgress) => void;
}

interface DiscoveredFiles {
  readonly files: string[];
  readonly ignoredCount: number;
  readonly failures: InventoryFailure[];
}

export class VaultInventoryService {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async scan(options: InventoryScanOptions): Promise<InventorySnapshot> {
    const discovered = await this.discoverFiles('', options.ignoredPaths);
    const entries: InventoryEntry[] = [];
    const failures: InventoryFailure[] = [...discovered.failures];

    for (const [index, path] of discovered.files.entries()) {
      options.onProgress?.({
        processedFiles: index,
        discoveredFiles: discovered.files.length,
        currentPath: path,
      });

      const validation = validateVaultRelativePath(path);
      if (!validation.valid) {
        failures.push({ path, message: validation.message });
        continue;
      }

      try {
        entries.push(await this.readStableEntry(validation.path));
      } catch (error) {
        failures.push({ path, message: errorMessage(error) });
      }
    }

    options.onProgress?.({
      processedFiles: discovered.files.length,
      discoveredFiles: discovered.files.length,
      currentPath: null,
    });

    const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
    return {
      summary: {
        scannedAt: this.now().toISOString(),
        fileCount: entries.length,
        totalBytes,
        ignoredCount: discovered.ignoredCount,
        failedCount: failures.length,
      },
      entries,
      failures,
    };
  }

  private async discoverFiles(
    folder: string,
    ignoredPaths: readonly string[],
  ): Promise<DiscoveredFiles> {
    const listing = await this.adapter.list(folder);
    const files = listing.files
      .filter((path) => !shouldIgnoreVaultPath(path, ignoredPaths))
      .sort((left, right) => left.localeCompare(right));
    let ignoredCount = listing.files.length - files.length;
    const failures: InventoryFailure[] = [];

    for (const childFolder of listing.folders.sort((left, right) => left.localeCompare(right))) {
      const validation = validateVaultRelativePath(childFolder);
      if (!validation.valid) {
        failures.push({ path: childFolder, message: validation.message });
        continue;
      }

      if (shouldIgnoreVaultPath(childFolder, ignoredPaths, true)) {
        ignoredCount += 1;
        continue;
      }

      const child = await this.discoverFiles(childFolder, ignoredPaths);
      files.push(...child.files);
      ignoredCount += child.ignoredCount;
      failures.push(...child.failures);
    }

    return { files, ignoredCount, failures };
  }

  private async readStableEntry(path: string): Promise<InventoryEntry> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await this.requireFileStat(path);
      const content = await this.adapter.readBinary(path);
      const after = await this.requireFileStat(path);

      if (sameStat(before, after) && after.size === content.byteLength) {
        return {
          path,
          size: content.byteLength,
          modifiedAt: new Date(after.mtime).toISOString(),
          hash: await calculateSha256(content),
        };
      }
    }

    throw new Error('O arquivo mudou durante a leitura; tente analisar novamente.');
  }

  private async requireFileStat(path: string): Promise<Stat> {
    const stat = await this.adapter.stat(path);
    if (stat === null || stat.type !== 'file') {
      throw new Error('O arquivo não está mais disponível.');
    }

    return stat;
  }
}

function sameStat(left: Stat, right: Stat): boolean {
  return left.mtime === right.mtime && left.size === right.size && left.type === right.type;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha desconhecida ao ler o arquivo.';
}
