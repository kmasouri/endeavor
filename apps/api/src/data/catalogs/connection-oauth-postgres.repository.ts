import { FastifyInstance } from 'fastify';
import { ConnectionOAuthSession } from '../../shared/connection-oauth';
import { ConnectionOAuthRepository } from './connection-oauth.repository';
import { CredentialCipher } from './credential-cipher';

export class ConnectionOAuthPostgresRepository implements ConnectionOAuthRepository {
  constructor(
    private readonly db: FastifyInstance['pg'],
    private readonly cipher: CredentialCipher
  ) {}

  async get(connectionId: string): Promise<ConnectionOAuthSession | null> {
    const row = (
      await this.db.query<{ session_ciphertext: string }>(
        'SELECT session_ciphertext FROM endeavor.connection_oauth WHERE connection_id = $1',
        [connectionId]
      )
    ).rows[0];
    return row ? JSON.parse(this.cipher.decrypt(row.session_ciphertext)) : null;
  }

  async withLock<T>(
    connectionId: string,
    work: (session: ConnectionOAuthSession | null) => Promise<{
      session: ConnectionOAuthSession | null;
      result: T;
    }>
  ): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '35s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 65))', [connectionId]);
      const row = (
        await client.query<{ session_ciphertext: string }>(
          'SELECT session_ciphertext FROM endeavor.connection_oauth WHERE connection_id = $1',
          [connectionId]
        )
      ).rows[0];
      const current = row ? JSON.parse(this.cipher.decrypt(row.session_ciphertext)) : null;
      const { session, result } = await work(current);
      if (session) {
        await client.query(
          `INSERT INTO endeavor.connection_oauth (connection_id, session_ciphertext)
          VALUES ($1, $2) ON CONFLICT (connection_id) DO UPDATE SET session_ciphertext = EXCLUDED.session_ciphertext`,
          [connectionId, this.cipher.encrypt(JSON.stringify(session))]
        );
      } else {
        await client.query('DELETE FROM endeavor.connection_oauth WHERE connection_id = $1', [
          connectionId
        ]);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
