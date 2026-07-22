import { describe, expect, it } from 'vitest';

import { parseOptionalJson } from '../src/drive/http-response';

describe('parseOptionalJson', () => {
  it('aceita corpo vazio usado no início do upload retomável', () => {
    expect(parseOptionalJson('')).toBeNull();
    expect(parseOptionalJson('  \n')).toBeNull();
  });

  it('preserva respostas JSON válidas do Drive', () => {
    expect(parseOptionalJson('{"id":"arquivo"}')).toEqual({ id: 'arquivo' });
  });

  it('não mascara o status HTTP quando o corpo não é JSON', () => {
    expect(parseOptionalJson('resposta sem JSON')).toBeNull();
  });
});
