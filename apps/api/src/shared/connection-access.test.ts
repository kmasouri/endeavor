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
  approvalMethods: [],
  discoverable: false,
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
    ['GET', 'invoices', 'single "/"'],
    ['GET', '/invoices/%2e%2e/admin', 'encoded'],
    ['GET', '/invoices/.%2E/secret', 'encoded'],
    ['GET', '/invoices\\..\\admin', '"\\"'],
    ['GET', '/invoices%2fadmin', 'encoded'],
    ['GET', '/invoices-admin/export', 'outside the allowed paths'],
    ['GET', '/invoicesecret', 'outside the allowed paths'],
    ['GET', '/customers', 'outside the allowed paths']
  ] as const)('denies %s %s', (method, path, reason) => {
    expect(connectionCallDenied(connection, method, path)).toContain(reason);
  });

  it('matches prefixes by whole segment', () => {
    expect(connectionCallDenied(connection, 'GET', '/invoices')).toBeNull();
    expect(connectionCallDenied(connection, 'GET', '/customers/7')).toBeNull();
  });

  it('denies everything on a disabled connection', () => {
    expect(
      connectionCallDenied({ ...connection, disabledAt: new Date() }, 'GET', '/invoices')
    ).toContain('disabled');
  });
});
