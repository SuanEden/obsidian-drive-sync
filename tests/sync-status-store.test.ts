import { describe, expect, it, vi } from 'vitest';

import { INITIAL_SYNC_STATUS } from '../src/domain/sync-status';
import { SyncStatusStore } from '../src/services/sync-status-store';

describe('SyncStatusStore', () => {
  it('publica o estado inicial ao assinar', () => {
    const listener = vi.fn();
    const store = new SyncStatusStore();

    store.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(INITIAL_SYNC_STATUS);
  });

  it('deixa de publicar após cancelar a assinatura', () => {
    const listener = vi.fn();
    const store = new SyncStatusStore();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.set({ ...INITIAL_SYNC_STATUS, phase: 'offline' });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
