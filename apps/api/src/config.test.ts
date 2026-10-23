import { parseEnv } from './config';

describe('parseEnv', () => {
  it('applies defaults when variables are not set', () => {
    expect(parseEnv({})).toMatchObject({
      ENVIRONMENT: 'production',
      HOST: '0.0.0.0',
      PORT: 3000,
      DATABASE_PORT: 5432,
      LOGGER_LEVEL: 'info',
      REQUEST_ID_HEADER: 'x-request-id'
    });
  });

  it('coerces numeric variables', () => {
    expect(parseEnv({ PORT: '8080', DATABASE_PORT: '6543' })).toMatchObject({
      PORT: 8080,
      DATABASE_PORT: 6543
    });
  });

  it('fails fast with the variable name when a value is invalid', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => parseEnv({ LOGGER_LEVEL: 'loud' })).toThrow(/LOGGER_LEVEL/);
    expect(() => parseEnv({ WEBHOOK_URL: 'not a url' })).toThrow(/WEBHOOK_URL/);
  });
});
