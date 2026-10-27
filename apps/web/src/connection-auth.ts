import type { Connection } from './api';

export function authenticationMethod(connection: Connection) {
  return connection.authMethod ?? (connection.hasCredential ? 'header' : 'none');
}

export function isAuthenticated(connection: Connection): boolean {
  return (
    connection.authenticated ??
    (authenticationMethod(connection) === 'header' && connection.hasCredential)
  );
}

export function authenticationLabel(connection: Connection): string {
  const method = authenticationMethod(connection);
  return method === 'oauth'
    ? 'OAuth sign-in'
    : method === 'header'
      ? 'API key / token'
      : 'No authentication';
}
