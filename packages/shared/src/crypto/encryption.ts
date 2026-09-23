import 'server-only';

/**
 * Encryption utilities for sensitive data storage (OAuth tokens, API keys)
 * Uses AES-256-GCM with HMAC for authenticated encryption
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

/**
 * Gets the encryption key from environment
 * Must be a 32-byte (256-bit) base64-encoded string
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  const keyBase64 = process.env.ENCRYPTION_KEY;

  if (!keyBase64) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. Generate with: openssl rand -base64 32',
    );
  }

  const keyBuffer = Buffer.from(keyBase64, 'base64');

  if (keyBuffer.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 32 bytes (256 bits) when decoded',
    );
  }

  return crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a string value using AES-256-GCM
 * Returns a base64 string containing IV + ciphertext + auth tag
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv,
      tagLength: TAG_LENGTH,
    },
    key,
    data,
  );

  // Combine IV + ciphertext (includes auth tag)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypts a string that was encrypted with encrypt()
 * Expects a base64 string containing IV + ciphertext + auth tag
 */
export async function decrypt(encryptedBase64: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, 'base64');

  if (combined.length < IV_LENGTH + TAG_LENGTH / 8) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv,
      tagLength: TAG_LENGTH,
    },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Checks if a value is encrypted (basic validation)
 */
export async function isEncrypted(value: string): Promise<boolean> {
  try {
    const decoded = Buffer.from(value, 'base64');
    // Minimum length: IV (12) + tag (16) + at least 1 byte of ciphertext
    return decoded.length >= IV_LENGTH + TAG_LENGTH / 8 + 1;
  } catch {
    return false;
  }
}
