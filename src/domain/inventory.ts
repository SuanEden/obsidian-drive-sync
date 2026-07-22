export interface InventoryEntry {
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly hash: string;
}

export interface InventoryFailure {
  readonly path: string;
  readonly message: string;
}

export interface InventorySummary {
  readonly scannedAt: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly ignoredCount: number;
  readonly failedCount: number;
}

export interface InventorySnapshot {
  readonly summary: InventorySummary;
  readonly entries: readonly InventoryEntry[];
  readonly failures: readonly InventoryFailure[];
}

export interface InventoryState {
  readonly latest: InventorySnapshot | null;
  readonly history: readonly InventorySummary[];
}

export const EMPTY_INVENTORY_STATE: InventoryState = {
  latest: null,
  history: [],
};

export interface InventoryProgress {
  readonly processedFiles: number;
  readonly discoveredFiles: number;
  readonly currentPath: string | null;
}
