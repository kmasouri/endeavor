import { setupApp } from '../../app';
import { currentLogger } from './request-logger';

describe('currentLogger', () => {
  it('returns the logger of the running request', async () => {
    const app = setupApp();
    app.get('/logger-check', async (request) => ({
      sameLogger: currentLogger(app.log) === request.log
    }));

    const response = await app.inject({ method: 'GET', url: '/logger-check' });

    expect(response.json()).toEqual({ sameLogger: true });
    await app.close();
  });

  it('returns the fallback logger outside a request', () => {
    const app = setupApp();

    expect(currentLogger(app.log)).toBe(app.log);
  });
});
