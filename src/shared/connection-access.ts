import { Connection, HttpMethod } from './types';

// The rules for one call through a connection. Returns why it is denied, or null if allowed.
// The runner also checks that the agent's grant is active; this only covers the connection.
export function connectionCallDenied(
  connection: Connection,
  method: HttpMethod,
  path: string
): string | null {
  if (connection.disabledAt) {
    return `The ${connection.name} connection is disabled.`;
  }
  if (!connection.allowedMethods.includes(method)) {
    return `${method} is not allowed on ${connection.name}. Allowed: ${connection.allowedMethods.join(', ')}.`;
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    return 'The path must start with a single "/".';
  }
  const pathOnly = path.split(/[?#]/)[0];
  if (pathOnly.split('/').some((segment) => segment === '..' || segment === '.')) {
    return 'The path may not contain "." or ".." segments.';
  }
  const allowed = connection.allowedPathPrefixes.some((prefix) => pathOnly.startsWith(prefix));
  if (!allowed) {
    return `${pathOnly} is outside the allowed paths on ${connection.name}: ${connection.allowedPathPrefixes.join(', ')}.`;
  }
  return null;
}
