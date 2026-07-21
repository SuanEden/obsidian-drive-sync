export type SyncPhase =
  'not-configured' | 'up-to-date' | 'syncing' | 'offline' | 'conflict' | 'error';

export interface SyncCounters {
  readonly uploaded: number;
  readonly downloaded: number;
}

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly lastSyncAt: string | null;
  readonly counters: SyncCounters;
  readonly message: string;
}

export const INITIAL_SYNC_STATUS: SyncStatus = {
  phase: 'not-configured',
  lastSyncAt: null,
  counters: { uploaded: 0, downloaded: 0 },
  message: 'Conecte uma conta e escolha um cofre remoto para começar.',
};

export function syncPhaseLabel(phase: SyncPhase): string {
  const labels: Record<SyncPhase, string> = {
    'not-configured': 'Não configurado',
    'up-to-date': 'Atualizado',
    syncing: 'Sincronizando',
    offline: 'Offline',
    conflict: 'Conflito',
    error: 'Erro',
  };

  return labels[phase];
}
