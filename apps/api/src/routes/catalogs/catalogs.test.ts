import { setupApp } from '../../app';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const SKILL = '00000000-0000-4000-8000-000000000002';
const CONNECTION = '00000000-0000-4000-8000-000000000003';

describe('instructions-only skill routes', () => {
  it.each(['/skills', `/skills/${SKILL}/versions`])(
    'rejects retired connectionIds on %s before calling a service',
    async (url) => {
      const app = setupApp();
      await app.ready();
      const create = jest.spyOn(app.skillService, 'createSkill');
      const version = jest.spyOn(app.skillService, 'addSkillVersion');
      try {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { 'x-actor-id': ACTOR },
          payload: {
            ...(url === '/skills' ? { name: 'Billing', description: 'Invoices' } : {}),
            instructions: 'Read invoices.',
            connectionIds: [CONNECTION]
          }
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.details).toContainEqual(
          expect.objectContaining({ field: 'connectionIds', in: 'body' })
        );
        expect(create).not.toHaveBeenCalled();
        expect(version).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it('accepts instructions-only creation and new versions', async () => {
    const app = setupApp();
    await app.ready();
    const create = jest
      .spyOn(app.skillService, 'createSkill')
      .mockResolvedValue({ id: SKILL } as never);
    const version = jest
      .spyOn(app.skillService, 'addSkillVersion')
      .mockResolvedValue({ id: SKILL } as never);
    try {
      const input = { name: 'Billing', description: 'Invoices', instructions: 'Read invoices.' };
      const created = await app.inject({
        method: 'POST',
        url: '/skills',
        headers: { 'x-actor-id': ACTOR },
        payload: input
      });
      const updated = await app.inject({
        method: 'POST',
        url: `/skills/${SKILL}/versions`,
        headers: { 'x-actor-id': ACTOR },
        payload: { instructions: 'Cite invoices.' }
      });
      expect(created.statusCode).toBe(201);
      expect(updated.statusCode).toBe(201);
      expect(create).toHaveBeenCalledWith(ACTOR, input);
      expect(version).toHaveBeenCalledWith(ACTOR, SKILL, { instructions: 'Cite invoices.' });
    } finally {
      await app.close();
    }
  });
});

describe('connection types', () => {
  it('accepts existing HTTP payloads and MCP payloads with explicit tool permissions', async () => {
    const app = setupApp();
    await app.ready();
    const create = jest
      .spyOn(app.connectionService, 'createConnection')
      .mockResolvedValue({ id: CONNECTION } as never);
    try {
      const shared = {
        name: 'Records',
        description: 'Records service',
        baseUrl: 'https://records.test/mcp'
      };
      for (const input of [
        { ...shared, allowedMethods: ['GET'], allowedPathPrefixes: ['/'] },
        { ...shared, kind: 'mcp', allowedTools: [], approvalTools: [] },
        { ...shared, kind: 'mcp', allowedTools: ['lookup', 'create'] }
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/connections',
          headers: { 'x-actor-id': ACTOR },
          payload: input
        });
        expect(response.statusCode).toBe(201);
      }
      expect(create).toHaveBeenCalledTimes(3);
    } finally {
      await app.close();
    }
  });

  it.each([
    { kind: 'mcp', allowedTools: ['lookup'], allowedMethods: ['POST'] },
    { kind: 'mcp', allowedTools: ['*'] },
    { kind: 'mcp', allowedTools: ['a'.repeat(129)] },
    { kind: 'http', allowedMethods: ['GET'], allowedPathPrefixes: ['/'], allowedTools: ['lookup'] },
    { kind: 'stdio', allowedTools: ['lookup'] }
  ])('rejects invalid or mixed transport configuration %#', async (config) => {
    const app = setupApp();
    await app.ready();
    const create = jest.spyOn(app.connectionService, 'createConnection');
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/connections',
        headers: { 'x-actor-id': ACTOR },
        payload: {
          name: 'Records',
          description: 'Records',
          baseUrl: 'https://records.test/mcp',
          ...config
        }
      });
      expect(response.statusCode).toBe(400);
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('routes discovery through the connection service', async () => {
    const app = setupApp();
    await app.ready();
    const discover = jest
      .spyOn(app.connectionService, 'discoverConnectionTools')
      .mockResolvedValue([
        { name: 'lookup', description: 'Look up records', inputSchema: { type: 'object' } }
      ]);
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/connections/${CONNECTION}/tools`,
        headers: { 'x-actor-id': ACTOR },
        payload: {}
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data[0].name).toBe('lookup');
      expect(discover).toHaveBeenCalledWith(ACTOR, CONNECTION);
    } finally {
      await app.close();
    }
  });
});

describe('OAuth connection routes', () => {
  it('sets a browser binding cookie and never returns the binding key in JSON', async () => {
    const app = setupApp();
    await app.ready();
    jest.spyOn(app.connectionService, 'startOAuth').mockResolvedValue({
      authorizationUrl: 'https://docs.example/authorize?state=test',
      browserKey: 'private-browser-key',
      callbackUrl: `http://localhost:3100/connections/${CONNECTION}/oauth/callback`
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/connections/${CONNECTION}/oauth/connect`,
        headers: { 'x-actor-id': ACTOR }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: { authorizationUrl: 'https://docs.example/authorize?state=test' }
      });
      expect(response.headers['set-cookie']).toContain('HttpOnly; SameSite=Lax');
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it('forwards the callback state, issuer and browser cookie and redirects without code', async () => {
    const app = setupApp();
    await app.ready();
    const finish = jest
      .spyOn(app.connectionService, 'finishOAuth')
      .mockResolvedValue('http://localhost:3100/app/#/catalogs?tab=connections&oauth=connected');
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/connections/${CONNECTION}/oauth/callback?state=nonce&code=secret-code&iss=https%3A%2F%2Fdocs.example`,
        headers: { cookie: `endeavor_oauth_${CONNECTION}=binding` }
      });
      expect(response.statusCode).toBe(302);
      expect(finish).toHaveBeenCalledWith(
        CONNECTION,
        { state: 'nonce', code: 'secret-code', iss: 'https://docs.example' },
        'binding'
      );
      expect(response.headers.location).not.toContain('secret-code');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['set-cookie']).toContain('Max-Age=0');
    } finally {
      await app.close();
    }
  });
});

describe('grant routes', () => {
  const AGENT = '00000000-0000-4000-8000-000000000004';

  it('lists, grants, and revokes access through the grant service', async () => {
    const app = setupApp();
    await app.ready();
    const grant = {
      agentId: AGENT,
      targetType: 'skill' as const,
      targetId: SKILL,
      grantedByHumanId: ACTOR,
      grantedAt: new Date(),
      revokedAt: null
    };
    const list = jest.spyOn(app.grantService, 'listGrants').mockResolvedValue([grant]);
    const create = jest.spyOn(app.grantService, 'grant').mockResolvedValue(grant);
    const revoke = jest.spyOn(app.grantService, 'revoke').mockResolvedValue();
    try {
      const listed = await app.inject({
        method: 'GET',
        url: `/agents/${AGENT}/grants?includeRevoked=true`
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data[0].targetId).toBe(SKILL);
      expect(list).toHaveBeenCalledWith(AGENT, true);

      const created = await app.inject({
        method: 'POST',
        url: `/agents/${AGENT}/grants`,
        headers: { 'x-actor-id': ACTOR },
        payload: { type: 'skill', id: SKILL }
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().data.targetId).toBe(SKILL);
      expect(create).toHaveBeenCalledWith(ACTOR, AGENT, { type: 'skill', id: SKILL });

      const revoked = await app.inject({
        method: 'DELETE',
        url: `/agents/${AGENT}/grants/skill/${SKILL}`,
        headers: { 'x-actor-id': ACTOR }
      });
      expect(revoked.statusCode).toBe(204);
      expect(revoke).toHaveBeenCalledWith(ACTOR, AGENT, { type: 'skill', id: SKILL });
    } finally {
      await app.close();
    }
  });
});
