import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from '../src/services/bounded-concurrency';

describe('runWithConcurrency', () => {
  it('executa em paralelo sem ultrapassar o limite', async () => {
    let active = 0;
    let maximum = 0;
    const resolvers: Array<() => void> = [];
    const running = runWithConcurrency([1, 2, 3, 4, 5], 3, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      active -= 1;
    });

    await waitFor(() => resolvers.length === 3);
    expect(maximum).toBe(3);
    resolvers.splice(0, 3).forEach((resolve) => resolve());
    await waitFor(() => resolvers.length === 2);
    resolvers.splice(0).forEach((resolve) => resolve());
    await running;
    expect(maximum).toBe(3);
  });

  it('para de iniciar novos trabalhos após a primeira falha', async () => {
    const started: number[] = [];
    await expect(
      runWithConcurrency([1, 2, 3, 4], 1, (item) => {
        started.push(item);
        return item === 2 ? Promise.reject(new Error('falha')) : Promise.resolve();
      }),
    ).rejects.toThrow('falha');
    expect(started).toEqual([1, 2]);
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error('Condição do teste não foi atingida.');
}
