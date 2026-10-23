// CA-29 spike: the "full" option, where the Vercel AI SDK runs the model/tool loop instead of
// the runner. Not wired into the runner; the tests next to it show how it behaves. The runner
// would pass its checks, records, and tools in as hooks.
//
// What the SDK's loop needs from us to stay safe:
// - Saving each model turn before its tools run. The SDK has a hook for this
//   (onLanguageModelCallEnd), but it swallows the hook's errors and runs the tools anyway, so
//   every tool has to check that the turn was saved, and the loop has to stop if it wasn't.
// - Running tools one at a time (the SDK runs them all at once by default) and skipping the
//   rest after a tool that ends the turn, such as ask.
// - Checking pause, version, lease, and budget before each model call (prepareStep).

import {
  generateText,
  hasToolCall,
  jsonSchema,
  stepCountIs,
  type AssistantModelMessage,
  type ToolSet
} from 'ai';
import { type AiSdkModelFactory, toMessages } from './model-ai-sdk.client';
import {
  ModelToolCall,
  ModelToolDefinition,
  ModelToolResult,
  ModelTranscriptEntry,
  ModelTurnResult
} from './model.client';

export interface AgentLoopHooks {
  // Runs before each model call. Throw to stop the loop (paused, moved version, lost lease,
  // over budget). The error reaches the caller.
  beforeModelCall(step: number): Promise<void>;
  // Must save the turn. If it throws, no tool from this turn runs and the loop stops.
  onModelTurn(turn: ModelTurnResult): Promise<void>;
  runTool(call: ModelToolCall): Promise<{ content: string; isError: boolean; stop: boolean }>;
  // Saves the step's tool results. Its errors are swallowed by the SDK; the tools are safe to
  // run again by call id, so a lost record only means they run again after a restart.
  onToolResults(results: ModelToolResult[]): Promise<void>;
}

export interface AgentLoopRequest {
  model: string;
  system: string;
  transcript: ModelTranscriptEntry[];
  tools: ModelToolDefinition[];
  // Tools that end the agent's turn, such as ask, complete_task, and report_blocked.
  stoppingTools: string[];
  maxTokens: number;
  maxSteps: number;
}

export type AgentLoopEnd = 'stopped_by_tool' | 'finished' | 'max_steps' | 'turn_not_saved';

export class TurnNotSavedError extends Error {}

export class AgentLoopAiSdkClient {
  constructor(private readonly modelFor: AiSdkModelFactory) {}

  async run(request: AgentLoopRequest, hooks: AgentLoopHooks): Promise<AgentLoopEnd> {
    let turnSaved = false;
    let saveFailed = false;
    let stopped = false;
    let stepResults: ModelToolResult[] = [];

    const tools: ToolSet = Object.fromEntries(
      request.tools.map((definition) => [
        definition.name,
        {
          description: definition.description,
          inputSchema: jsonSchema(definition.inputSchema),
          execute: async (input: unknown, { toolCallId }: { toolCallId: string }) => {
            if (!turnSaved) {
              throw new TurnNotSavedError('The turn was not saved, so this tool did not run.');
            }
            if (stopped) {
              stepResults.push({ callId: toolCallId, content: SKIPPED, isError: true });
              return SKIPPED;
            }
            const outcome = await hooks.runTool({ id: toolCallId, name: definition.name, input });
            stepResults.push({
              callId: toolCallId,
              content: outcome.content,
              isError: outcome.isError
            });
            stopped = stopped || outcome.stop || request.stoppingTools.includes(definition.name);
            if (outcome.isError) {
              throw new Error(outcome.content);
            }
            return outcome.content;
          }
        }
      ])
    );

    const result = await generateText({
      model: this.modelFor(request.model),
      system: request.system,
      messages: toMessages(request.transcript),
      tools,
      maxOutputTokens: request.maxTokens,
      maxRetries: 0,
      toolCallConcurrency: 1,
      stopWhen: [
        stepCountIs(request.maxSteps),
        hasToolCall(...request.stoppingTools),
        () => stopped || saveFailed
      ],
      prepareStep: async ({ stepNumber }) => {
        turnSaved = false;
        stepResults = [];
        await hooks.beforeModelCall(stepNumber);
        return undefined;
      },
      onLanguageModelCallEnd: async (event) => {
        const toolCalls: ModelToolCall[] = [];
        const content: AssistantModelMessage['content'] = [];
        for (const part of event.content) {
          if (part.type === 'text') {
            content.push({ type: 'text', text: part.text });
          } else if (part.type === 'tool-call') {
            toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input });
            content.push({
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input
            });
          }
        }
        try {
          await hooks.onModelTurn({
            text: content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
            toolCalls,
            stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
            raw: [{ role: 'assistant', content }],
            usage: {
              inputTokens: event.usage.inputTokens ?? 0,
              outputTokens: event.usage.outputTokens ?? 0
            },
            servedModel: event.modelId
          });
          turnSaved = true;
        } catch {
          saveFailed = true;
        }
      },
      onStepEnd: async () => {
        if (stepResults.length > 0) {
          await hooks.onToolResults(stepResults);
        }
      }
    });

    if (saveFailed) return 'turn_not_saved';
    if (stopped) return 'stopped_by_tool';
    if (result.steps.length >= request.maxSteps && result.toolCalls.length > 0) return 'max_steps';
    return 'finished';
  }
}

const SKIPPED = 'Skipped: an earlier tool call in this turn already ended your turn.';
