export async function calculateSha256(data: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error('SHA-256 não está disponível neste dispositivo.');
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}
