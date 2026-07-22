import { describe, expect, it, vi } from 'vitest';

import { withDriveRetry, type RetryPolicy } from '../src/drive/retry';

function policy(): RetryPolicy {
  return {
    maxAttempts: 3,
    baseDelayMs: 1,
    maxDelayMs: 10,
    random: () => 0,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

describe('withDriveRetry para transporte', () => {
  it('repete UnknownHostException e conclui quando o DNS retorna', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Error(
          'Request Failed. UnknownHostException Unable to resolve host "www.googleapis.com"',
        ),
      )
      .mockResolvedValue('ok');

    await expect(withDriveRetry(operation, policy())).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('não repete erros de validação locais', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error('Caminho remoto inseguro'));

    await expect(withDriveRetry(operation, policy())).rejects.toThrow('Caminho remoto inseguro');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
