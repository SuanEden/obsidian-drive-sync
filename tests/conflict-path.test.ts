import { describe, expect, it } from 'vitest';

import { createConflictPath } from '../src/sync/conflict-path';

const DATE = new Date('2026-07-21T13:45:06.000Z');

describe('createConflictPath', () => {
  it('preserva pasta e extensão com nome legível', () => {
    expect(createConflictPath('Notas/projeto.md', DATE, 'Celular')).toBe(
      'Notas/projeto (conflito 2026-07-21 13-45-06 Celular).md',
    );
  });

  it('sanitiza o aparelho e usa um nome padrão quando necessário', () => {
    expect(createConflictPath('nota', DATE, ' Android/Principal\\ ')).toBe(
      'nota (conflito 2026-07-21 13-45-06 Android-Principal)',
    );
    expect(createConflictPath('nota.md', DATE, '\n')).toContain('aparelho');
  });

  it('acrescenta sufixo sem sobrescrever conflito existente', () => {
    const first = createConflictPath('nota.md', DATE, 'Linux');
    expect(createConflictPath('nota.md', DATE, 'Linux', new Set([first]))).toBe(
      'nota (conflito 2026-07-21 13-45-06 Linux) 2.md',
    );
  });

  it('rejeita caminho original inseguro', () => {
    expect(() => createConflictPath('../nota.md', DATE, 'Linux')).toThrow('ponto duplo');
  });
});
