import type { AgentVersion, Provider } from '../api';
export interface ConfigValues {
  instructions: string;
  provider: Provider;
  model: string;
  skillIds?: string[];
  connectionIds?: string[];
  limits: {
    maxModelTurns?: number;
    maxTokens?: number;
    maxCostUsd?: number;
    maxWorkingMinutes?: number;
  };
}
export function initialConfig(current?: AgentVersion | null): ConfigValues {
  return {
    instructions: current?.instructions ?? '',
    provider: current?.provider ?? 'openai',
    model: current?.model ?? '',
    limits: { ...(current?.limits ?? {}) }
  };
}
