import { FastifyInstance } from 'fastify';
import { ConnectionOAuthPostgresRepository } from './connection-oauth-postgres.repository';
import { CredentialCipher } from './credential-cipher';
import { ConnectionOAuthSession } from '../../shared/connection-oauth';

it('encrypts the whole session and releases its transaction lock after persistence', async () => {
  const cipher = new CredentialCipher(Buffer.alloc(32, 7).toString('base64'));
  const query = jest.fn(async () => ({ rows: [] }));
  const release = jest.fn();
  const repository = new ConnectionOAuthPostgresRepository(
    { connect: async () => ({ query, release }) } as unknown as FastifyInstance['pg'],
    cipher
  );
  const session: ConnectionOAuthSession = {
    resource: 'https://docs.example/mcp',
    callbackUrl: 'http://localhost/callback',
    actorId: 'h1',
    status: 'connected',
    data: {
      tokens: { access_token: 'secret-access', refresh_token: 'secret-refresh' },
      client: { client_secret: 'private-client' },
      verifier: 'private-verifier'
    }
  };
  expect(await repository.withLock('c1', async () => ({ session, result: 'done' }))).toBe('done');
  const calls = query.mock.calls as unknown as [string, unknown[]][];
  const insert = calls.find(([sql]) => sql.startsWith('INSERT'))!;
  expect(JSON.stringify(calls)).not.toContain('secret-access');
  expect(JSON.stringify(calls)).not.toContain('secret-refresh');
  expect(JSON.parse(cipher.decrypt(insert[1][1] as string))).toEqual(session);
  expect(calls.findIndex(([sql]) => sql.includes('pg_advisory_xact_lock'))).toBeLessThan(
    calls.findIndex(([sql]) => sql.startsWith('SELECT session'))
  );
  expect(calls.at(-1)?.[0]).toBe('COMMIT');
  expect(release).toHaveBeenCalledTimes(1);
});

it('rolls back a failed state transition without committing tokens', async () => {
  const query = jest.fn(async () => ({ rows: [] }));
  const release = jest.fn();
  const repository = new ConnectionOAuthPostgresRepository(
    { connect: async () => ({ query, release }) } as unknown as FastifyInstance['pg'],
    new CredentialCipher(Buffer.alloc(32, 1).toString('base64'))
  );
  await expect(
    repository.withLock('c1', async () => {
      throw new Error('callback mismatch');
    })
  ).rejects.toThrow('callback mismatch');
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(release).toHaveBeenCalledTimes(1);
});
