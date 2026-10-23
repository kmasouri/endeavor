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
  // URL parsing decodes %2e and treats "\" as "/", so either could hide a ".." segment that
  // the check below would miss. Encoded slashes are refused for the same reason.
  if (/\\|%2e|%2f|%5c/i.test(pathOnly)) {
    return 'The path may not contain "\\" or encoded ".", "/", or "\\".';
  }
  if (pathOnly.split('/').some((segment) => segment === '..' || segment === '.')) {
    return 'The path may not contain "." or ".." segments.';
  }
  // The path must be exactly what a URL parser would request, with nothing normalized away.
  if (new URL(pathOnly, 'http://check.invalid').pathname !== pathOnly) {
    return 'The path is not in a plain form.';
  }
  if (!connection.allowedPathPrefixes.some((prefix) => pathWithin(pathOnly, prefix))) {
    return `${pathOnly} is outside the allowed paths on ${connection.name}: ${connection.allowedPathPrefixes.join(', ')}.`;
  }
  return null;
}

// Prefixes match whole path segments: "/invoices" allows "/invoices" and "/invoices/42", but
// not "/invoices-admin". A prefix ending in "/" allows only what is below it.
export function pathWithin(path: string, prefix: string): boolean {
  if (prefix === '/' || path === prefix) {
    return true;
  }
  return path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}
