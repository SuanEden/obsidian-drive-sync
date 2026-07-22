import { describe, expect, it } from 'vitest';

import { assertVaultRelativePath, validateVaultRelativePath } from '../src/domain/vault-path';

describe('validateVaultRelativePath', () => {
  it.each(['Notas/Projeto.md', 'anexos/imagem 01.png', '.obsidian/themes/tema/theme.css'])(
    'aceita caminho relativo seguro: %s',
    (path) => {
      expect(validateVaultRelativePath(path)).toEqual({ valid: true, path });
    },
  );

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['C:/Users/Teste/nota.md', 'windows-drive'],
    ['Notas\\segredo.md', 'backslash'],
    ['Notas//segredo.md', 'empty-segment'],
    ['Notas/', 'empty-segment'],
    ['./segredo.md', 'dot-segment'],
    ['Notas/../segredo.md', 'dot-segment'],
    ['Notas/segredo\u0000.md', 'control-character'],
  ])('rejeita %j com o código %s', (path, code) => {
    expect(validateVaultRelativePath(path)).toMatchObject({ valid: false, code });
  });

  it('falha de forma explícita antes de um caminho perigoso chegar ao Adapter', () => {
    expect(() => assertVaultRelativePath('../../fora-do-cofre')).toThrow('ponto duplo');
  });
});
