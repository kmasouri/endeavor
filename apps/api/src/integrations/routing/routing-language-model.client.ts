// Routing through an ordinary language model, like gpt-5.4-mini. The model is asked to give a
// probability for every option, in a fixed JSON shape. Those numbers are the model's own
// estimate, so they may be less reliable than a decision model's.

import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import {
  HandoffChoice,
  HandoffRequest,
  RoutingClient,
  RoutingClientError,
  RoutingDecision,
  StarterChoice,
  StarterRequest
} from './routing.client';
import { handoffQuestion, RoutingQuestion, starterQuestion, toDecision } from './routing-options';

type ProviderOptions = Parameters<typeof generateText>[0]['providerOptions'];

// OpenAI through its Responses API, with little reasoning: routing should be quick and cheap.
export function createOpenAiRoutingModel(
  apiKey: string,
  baseUrl: string,
  model: string
): { model: LanguageModel; options: ProviderOptions } {
  return {
    model: createOpenAI({ apiKey, baseURL: baseUrl }).responses(model),
    options: { openai: { store: false, reasoningEffort: 'low' } }
  };
}

export class RoutingLanguageModelClient implements RoutingClient {
  readonly engine = 'language-model';

  constructor(
    private readonly model: LanguageModel,
    private readonly options?: ProviderOptions
  ) {}

  chooseStarter(request: StarterRequest): Promise<RoutingDecision<StarterChoice>> {
    return this.decide(starterQuestion(request), { kind: 'ask' }, request.signal);
  }

  chooseAfterTask(request: HandoffRequest): Promise<RoutingDecision<HandoffChoice>> {
    return this.decide(handoffQuestion(request), { kind: 'ask' }, request.signal);
  }

  private async decide<CHOICE>(
    question: RoutingQuestion<CHOICE>,
    fallback: CHOICE,
    signal: AbortSignal | undefined
  ): Promise<RoutingDecision<CHOICE>> {
    const keys = Object.keys(question.options);
    const schema = z.strictObject({
      probabilities: z.strictObject(Object.fromEntries(keys.map((key) => [key, z.number()])))
    });
    const system = [
      question.instructions,
      'Give each option the probability, from 0 to 1, that it is the right pick. They should add up to 1.',
      `Options: ${JSON.stringify(question.options)}`
    ].join('\n\n');

    const result = await generateText({
      model: this.model,
      system,
      prompt: JSON.stringify(question.state),
      output: Output.object({ schema }),
      providerOptions: this.options,
      abortSignal: signal,
      // The caller decides whether to try again.
      maxRetries: 0
    }).catch((error: unknown) => {
      const retryable = APICallError.isInstance(error) ? error.isRetryable : true;
      throw new RoutingClientError(
        `Routing call failed: ${(error as Error).message}`,
        this.engine,
        retryable,
        { cause: error }
      );
    });

    return toDecision(question, result.output.probabilities, fallback, {
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0
      },
      servedModel: result.response.modelId ?? 'unknown'
    });
  }
}
