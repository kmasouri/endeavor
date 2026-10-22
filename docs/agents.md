# Agents and model providers

An agent is a configured participant. It is not a built-in role: a QA agent and a research agent are the same kind of thing with different settings. No agent is in charge of another.

## What an agent has

- **Name and purpose.** What the agent is for, shown in the directory. Changing these doesn't create a new version.
- **Configuration (versioned).** Instructions, provider, and model. Saving any change creates a new version, and versions never change once saved. Each task records the version it started with, so editing an agent never changes work that is already running or waiting. Only new tasks use the new version.
- **Skills and connections.** Chosen from the shared catalogs (coming with CA-1). They are saved with the configuration version.

Only admins create or change agents. A disabled agent takes no new tasks, but its open tasks keep going until a human pauses or cancels them.

## Example configurations

These are examples, not built-in roles. Create them with `POST /agents`.

```json
{
  "name": "QA",
  "purpose": "Tests the staging site and reports failures with steps to reproduce.",
  "instructions": "Run the checkout tests. When one fails, ask Engineering to look into it, and include the steps and logs.",
  "provider": "anthropic",
  "model": "claude-opus-5-5"
}
```

```json
{
  "name": "Researcher",
  "purpose": "Finds and summarizes sources on a question.",
  "instructions": "Answer with a short summary. Cite a source for every claim. Ask a clarifying question when the request is unclear.",
  "provider": "openai",
  "model": "<an OpenAI model>"
}
```

## Providers

`GET /providers` lists each provider and whether it is ready.

| Provider    | Ready when                 | Notes                                                                                           |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `anthropic` | `ANTHROPIC_API_KEY` is set | Uses `@anthropic-ai/sdk`. Turns on the server-side refusal fallback for models that support it. |
| `openai`    | `OPENAI_API_KEY` is set    | Calls the Chat Completions API with `fetch`. `OPENAI_BASE_URL` can point at a compatible API.   |
| `scripted`  | Always                     | A fake that answers from a script. For tests and demos; no model is called.                     |

You can save an agent on a provider that isn't ready. Its `providerReady` is `false`, and its tasks can't run until the key is set.

**Local execution doesn't mean local models.** The platform and its tools run on this computer, but every model call goes over the internet to the provider.

## Adding a provider

1. Add its name to `MODEL_PROVIDERS` in `src/shared/types.ts`.
2. Write a `ModelClient` in `src/integrations/models/`. It turns a `ModelTurnRequest` into the provider's API call, and the reply into a `ModelTurnResult`. Keep the provider's own assistant message in `raw`, so it can be sent back unchanged.
3. Add its key to `src/config.ts`, `README.md`, and `.env.example`, and turn it on in `readyProviders()` in `src/plugins/agent.ts`.

Nothing else changes: conversations and tasks only use the `ModelClient` interface.
