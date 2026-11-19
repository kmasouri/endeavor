// Routing through a decision model, like OpenAI's gpt-6-luna. A decision model answers a typed
// question and returns a probability for every option, so confidence comes from the model
// itself instead of a number it was asked to write down.

import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  experimental_decide as decide,
  type Experimental_DecisionModel as DecisionModel
} from 'ai';
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

export function createOpenAiDecisionModel(
  apiKey: string,
  baseUrl: string,
  model: string
): DecisionModel {
  return createOpenAI({ apiKey, baseURL: baseUrl }).decisionModel(model);
}

export class RoutingDecisionModelClient implements RoutingClient {
  readonly engine = 'decision-model';

  constructor(private readonly model: DecisionModel) {}

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
    let result: Awaited<ReturnType<typeof decide>>;
    try {
      result = await decide({
        model: this.model,
        state: JSON.parse(JSON.stringify(question.state)),
        questions: {
          next: { type: 'choice', instructions: question.instructions, criteria: question.options }
        },
        abortSignal: signal,
        // The caller decides whether to try again.
        maxRetries: 0
      });
    } catch (error) {
      const retryable = APICallError.isInstance(error) ? error.isRetryable : true;
      throw new RoutingClientError(
        `Routing call failed: ${(error as Error).message}`,
        this.engine,
        retryable,
        { cause: error }
      );
    }

    const answer = result.answers.next;
    if (answer.type !== 'choice') {
      throw new RoutingClientError(`Routing got a ${answer.type} answer.`, this.engine, false);
    }
    const decision = toDecision(
      question,
      answer.probabilities ?? { [answer.choice]: 1 },
      fallback,
      {
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0
        },
        servedModel: result.response.modelId
      }
    );
    // Without probabilities, only the pick is known, and nothing says how sure it is.
    return answer.probabilities ? decision : { ...decision, confidence: 0 };
  }
}
