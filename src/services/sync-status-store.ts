import { INITIAL_SYNC_STATUS, type SyncStatus } from '../domain/sync-status';

export type SyncStatusListener = (status: SyncStatus) => void;

export class SyncStatusStore {
  private current: SyncStatus = INITIAL_SYNC_STATUS;
  private readonly listeners = new Set<SyncStatusListener>();

  get(): SyncStatus {
    return this.current;
  }

  set(status: SyncStatus): void {
    this.current = status;
    this.listeners.forEach((listener) => listener(status));
  }

  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
}
