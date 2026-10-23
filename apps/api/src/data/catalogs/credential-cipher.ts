import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encrypts connection credentials at rest with AES-256-GCM. The key is 32 bytes, given as
// base64 or hex in CREDENTIALS_KEY. Stored as "v1:<iv>:<tag>:<ciphertext>", all base64.
export class CredentialCipher {
  private readonly key: Buffer | null;

  constructor(key: string | undefined) {
    this.key = key ? parseKey(key) : null;
  }

  get ready(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
      .join(':');
  }

  decrypt(stored: string): string {
    const key = this.requireKey();
    const [version, iv, tag, ciphertext] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || ciphertext === undefined) {
      throw new Error('Stored credential has an unknown format');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error('CREDENTIALS_KEY is not set');
    }
    return this.key;
  }
}

function parseKey(value: string): Buffer {
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_KEY must be 32 bytes, as base64 or 64 hex characters');
  }
  return key;
}
