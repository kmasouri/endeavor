import { Connection } from '../../shared/types';
import { isEmptyScope, limitConnection, narrowScope, scopeOf } from './capability-access';

const wiki: Connection = {
  id: 'conn-wiki',
  kind: 'http',
  name: 'Wikipedia',
  description: 'Read pages',
  baseUrl: 'https://wiki.test',
  authHeader: 'Authorization',
  hasCredential: false,
  allowedMethods: ['GET', 'POST'],
  allowedPathPrefixes: ['/'],
  approvalMethods: ['POST'],
  discoverable: true,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

describe('narrowScope', () => {
  it('keeps only methods and paths in both the approved and current scope', () => {
    expect(
      narrowScope(
        { kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki'] },
        { kind: 'http', methods: ['GET', 'POST'], pathPrefixes: ['/'] }
      )
    ).toEqual({ kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki'] });
  });

  it('never widens when the catalog adds methods or paths later', () => {
    const scope = narrowScope(
      { kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki'] },
      { kind: 'http', methods: ['GET', 'DELETE'], pathPrefixes: ['/', '/admin'] }
    );
    expect(scope).toEqual({ kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki'] });
  });

  it('narrows to the catalog when it shrinks, matching whole path segments', () => {
    expect(
      narrowScope(
        { kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki'] },
        { kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki/en', '/wikipedia'] }
      )
    ).toEqual({ kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki/en'] });
  });

  it('is empty when nothing overlaps', () => {
    const scope = narrowScope(
      { kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki'] },
      { kind: 'http', methods: ['POST'], pathPrefixes: ['/wiki'] }
    );
    expect(isEmptyScope(scope)).toBe(true);
  });

  it('keeps only MCP tools in both scopes', () => {
    expect(
      narrowScope({ kind: 'mcp', tools: ['lookup'] }, { kind: 'mcp', tools: ['lookup', 'delete'] })
    ).toEqual({ kind: 'mcp', tools: ['lookup'] });
  });
});

describe('limitConnection', () => {
  it('limits the connection to the approved scope and keeps its approval rules', () => {
    const limited = limitConnection(wiki, { kind: 'http', methods: ['GET'], pathPrefixes: ['/w'] });
    expect(limited.allowedMethods).toEqual(['GET']);
    expect(limited.allowedPathPrefixes).toEqual(['/w']);
    expect(limited.approvalMethods).toEqual(['POST']);
    expect(scopeOf(wiki)).toEqual({ kind: 'http', methods: ['GET', 'POST'], pathPrefixes: ['/'] });
  });
});
