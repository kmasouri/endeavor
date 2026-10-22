import { connectionCallDenied } from './connection-access';
import { Connection } from './types';

const connection: Connection = {
  id: 'c1',
  name: 'Billing API',
  description: 'Billing',
  baseUrl: 'https://billing.test',
  authHeader: 'Authorization',
  hasCredential: true,
  allowedMethods: ['GET'],
  allowedPathPrefixes: ['/invoices', '/customers/'],
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

describe('connectionCallDenied', () => {
  it('allows an allowed method on an allowed path', () => {
    expect(connectionCallDenied(connection, 'GET', '/invoices/42?expand=lines')).toBeNull();
  });

  it.each([
    ['POST', '/invoices', 'POST is not allowed'],
    ['GET', '/admin', 'outside the allowed paths'],
    ['GET', '/invoices/../admin', '".." segments'],
    ['GET', '//evil.test/invoices', 'single "/"'],
    ['GET', 'invoices', 'single "/"']
  ] as const)('denies %s %s', (method, path, reason) => {
    expect(connectionCallDenied(connection, method, path)).toContain(reason);
  });

  it('denies everything on a disabled connection', () => {
    expect(
      connectionCallDenied({ ...connection, disabledAt: new Date() }, 'GET', '/invoices')
    ).toContain('disabled');
  });
});
