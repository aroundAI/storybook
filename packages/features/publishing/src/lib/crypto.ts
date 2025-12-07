import 'server-only';

import crypto from 'crypto';

/**
 * Encryption algorithm configuration
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Gets the encryption key from environment variables.
 * The key must be exactly 32 bytes (256 bits) for AES-256.
 *
 * @throws Error if TOKEN_ENCRYPTION_KEY is not set or invalid length
 */
function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY environment variable is not configured',
    );
  }

  // Support both hex-encoded keys and raw strings
  const keyBuffer =
    key.length === KEY_LENGTH * 2 ? Buffer.from(key, 'hex') : Buffer.from(key);

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be exactly ${KEY_LENGTH} bytes (or ${KEY_LENGTH * 2} hex characters)`,
    );
  }

  return keyBuffer;
}

/**
 * Encrypts a string using AES-256-GCM.
 *
 * The output format is: base64(iv + authTag + ciphertext)
 *
 * @param plaintext The string to encrypt
 * @returns Base64-encoded encrypted data
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return combined.toString('base64');
}

/**
 * Decrypts a string encrypted with the encrypt function.
 *
 * @param encryptedData Base64-encoded encrypted data
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (invalid data or wrong key)
 */
export async function decrypt(encryptedData: string): Promise<string> {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedData, 'base64');

  // Extract iv, authTag, and ciphertext
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Generates a new random encryption key.
 * Use this to generate a value for TOKEN_ENCRYPTION_KEY.
 *
 * @returns Hex-encoded 32-byte key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Validates that the encryption key is properly configured.
 * Call this at startup to fail fast if configuration is wrong.
 *
 * @returns true if key is valid
 * @throws Error if key is misconfigured
 */
export function validateEncryptionConfig(): boolean {
  getEncryptionKey();
  return true;
}
