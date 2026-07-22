import { describe, expect, it } from 'vitest';

import { calculateSha256 } from '../src/services/sha256';

describe('calculateSha256', () => {
  it('calcula um hash SHA-256 conhecido usando Web Crypto', async () => {
    const bytes = new TextEncoder().encode('abc');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    await expect(calculateSha256(buffer)).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
