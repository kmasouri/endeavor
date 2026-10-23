import { config } from '../config';
import { readyProviders } from './agent';

describe('readyProviders', () => {
  it('turns on a provider only when its key is set', () => {
    expect(
      readyProviders({ ...config, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined })
    ).toEqual(['scripted']);
    expect(readyProviders({ ...config, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })).toEqual([
      'anthropic',
      'openai',
      'scripted'
    ]);
  });
});
