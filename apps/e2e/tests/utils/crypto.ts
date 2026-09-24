import { webcrypto } from 'node:crypto';

/**
 * `@kit/shared/crypto`'s format: base64(IV ‖ AES-256-GCM ciphertext+tag), so
 * a seeded token decrypts in the app under test. Needs the same
 * `ENCRYPTION_KEY` in this run's environment as in the server's.
 */
export async function encryptLikeTheApp(plaintext: string) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64'),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext),
  );

  return Buffer.concat([iv, new Uint8Array(ciphertext)]).toString('base64');
}
