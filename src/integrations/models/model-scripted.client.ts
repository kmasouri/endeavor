import {
  ModelClient,
  ModelToolCall,
  ModelTranscriptEntry,
  ModelTurnRequest,
  ModelTurnResult
} from './model.client';

// A fake provider that answers from a script instead of a real model. Tests and local demos use
// it, so the collaboration loop can run with no API keys and no cost.
//
// The script is a function from the request to the next step. With no script, the agent posts
// nothing and ends its turn.
export interface ScriptedStep {
  text?: string;
  toolCalls?: Omit<ModelToolCall, 'id'>[];
}

export type ModelScript = (request: ModelTurnRequest) => ScriptedStep;

export class ModelScriptedClient implements ModelClient {
  readonly provider = 'scripted' as const;
  private callCount = 0;

  constructor(private readonly script: ModelScript = () => ({ text: '' })) {}

  async complete(request: ModelTurnRequest): Promise<ModelTurnResult> {
    const step = this.script(request);
    const toolCalls = (step.toolCalls ?? []).map((call) => ({
      ...call,
      id: `scripted-${++this.callCount}`
    }));
    return {
      text: step.text ?? '',
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
      raw: { text: step.text ?? '', toolCalls },
      usage: {
        inputTokens: countWords(request),
        outputTokens: wordCount(step.text ?? '')
      },
      servedModel: request.model
    };
  }
}

function countWords(request: ModelTurnRequest): number {
  const parts = request.transcript.map((entry: ModelTranscriptEntry) =>
    entry.role === 'user' ? entry.text : JSON.stringify(entry)
  );
  return wordCount([request.system, ...parts].join(' '));
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
