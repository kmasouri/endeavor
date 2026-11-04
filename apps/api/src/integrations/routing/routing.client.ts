// A way to fill the two routing gaps (CA-11): who should start a request that tags no one, and
// what happens when a task ends without a handoff. Any engine can sit behind this interface: a
// decision model, a plain model call, or fixed rules.
//
// The engine has no authority. It only sees what the caller passes in, and it can only pick one
// of the agents it was given, no one, or "ask a person". Acting on the pick, and deciding how sure
// is sure enough, is the caller's job. Tags that people or agents make never come here.

export interface RoutingAgent {
  id: string;
  name: string;
  purpose: string;
}

// A recent message, for context. The caller passes only what the members can already see.
export interface RoutingMessage {
  author: string;
  body: string;
}

export interface StarterRequest {
  goal?: string;
  // The message that tags no one.
  message: string;
  // The agents in the endeavor. The engine can only pick one of these.
  agents: RoutingAgent[];
  recent?: RoutingMessage[];
  signal?: AbortSignal;
}

export interface HandoffRequest {
  // What the endeavor is for: the request that started it.
  goal: string;
  // The agent whose task just ended, and its last message.
  finishedAgent: RoutingAgent;
  result: string;
  // The agents in the endeavor, including the one that finished.
  agents: RoutingAgent[];
  recent?: RoutingMessage[];
  signal?: AbortSignal;
}

// none: the message isn't a request, so nothing should run. ask: a person should pick.
export type StarterChoice = { kind: 'agent'; agentId: string } | { kind: 'none' } | { kind: 'ask' };

// done: the goal is met, so the result goes back to whoever asked.
export type HandoffChoice = { kind: 'agent'; agentId: string } | { kind: 'done' } | { kind: 'ask' };

export interface RoutingDecision<CHOICE> {
  choice: CHOICE;
  // How likely the choice is right, from 0 to 1.
  confidence: number;
  // Every option the engine scored, most likely first, so a person can be offered the top ones.
  ranked: { choice: CHOICE; probability: number }[];
  usage: { inputTokens: number; outputTokens: number };
  // The model that answered, or the engine's name when no model was used.
  servedModel: string;
}

export interface RoutingClient {
  // A short name for logs, like "openai-decision".
  readonly engine: string;
  chooseStarter(request: StarterRequest): Promise<RoutingDecision<StarterChoice>>;
  chooseAfterTask(request: HandoffRequest): Promise<RoutingDecision<HandoffChoice>>;
}

// Thrown for any engine failure. retryable tells the caller whether trying again could help.
export class RoutingClientError extends Error {
  constructor(
    message: string,
    public readonly engine: string,
    public readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'RoutingClientError';
  }
}
