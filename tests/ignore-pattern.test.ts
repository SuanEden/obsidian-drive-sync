import { describe, expect, it } from 'vitest';

import { shouldIgnoreVaultPath } from '../src/domain/ignore-pattern';

describe('shouldIgnoreVaultPath', () => {
  it.each([
    ['.obsidian/workspace.json', false],
    ['.obsidian/plugins/obsidian-drive-sync/data.json', false],
    ['rascunho.tmp', false],
    ['Notas/rascunho.tmp', false],
    ['Nota conflicted copy 2026.md', false],
    ['.trash', true],
    ['.trash/nota.md', false],
  ] as const)('ignora %s', (path, isFolder) => {
    expect(
      shouldIgnoreVaultPath(
        path,
        [
          '.obsidian/workspace.json',
          '.obsidian/plugins/obsidian-drive-sync/data.json',
          '.trash/',
          '*.tmp',
          '*conflicted copy*',
        ],
        isFolder,
      ),
    ).toBe(true);
  });

  it('não ignora arquivo regular com nome parecido', () => {
    expect(shouldIgnoreVaultPath('Notas/workspace.json', ['.obsidian/workspace.json'])).toBe(false);
  });

  it('suporta interrogação e estrela dupla', () => {
    expect(shouldIgnoreVaultPath('cache/a/item-1.bin', ['cache/**/item-?.bin'])).toBe(true);
  });

  it.each([
    '.obsidian/plugins/obsidian-drive-sync/node_modules',
    '.obsidian/plugins/obsidian-drive-sync/node_modules/pacote/index.js',
    'projeto/.git',
    'projeto/coverage/relatorio.json',
  ])('aplica padrão de diretório em qualquer profundidade: %s', (path) => {
    const isFolder = !path.includes('.') || path.endsWith('node_modules') || path.endsWith('.git');
    expect(shouldIgnoreVaultPath(path, ['node_modules/', '.git/', 'coverage/'], isFolder)).toBe(
      true,
    );
  });
});
