import { randomBytes } from 'node:crypto';
import { CredentialCipher } from './credential-cipher';

describe('CredentialCipher', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a credential and never stores it in plain text', () => {
    const cipher = new CredentialCipher(key);

    const stored = cipher.encrypt('Bearer secret-token');

    expect(stored).not.toContain('secret-token');
    expect(cipher.decrypt(stored)).toBe('Bearer secret-token');
  });

  it('uses a fresh IV each time', () => {
    const cipher = new CredentialCipher(key);

    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('rejects tampered ciphertext', () => {
    const cipher = new CredentialCipher(key);
    const [version, iv, tag, data] = cipher.encrypt('secret').split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;

    expect(() =>
      cipher.decrypt([version, iv, tag, flipped.toString('base64')].join(':'))
    ).toThrow();
  });

  it('accepts a hex key and refuses a short one', () => {
    expect(new CredentialCipher(randomBytes(32).toString('hex')).ready).toBe(true);
    expect(() => new CredentialCipher('short')).toThrow('32 bytes');
    expect(new CredentialCipher(undefined).ready).toBe(false);
  });
});
