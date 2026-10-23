import { useState } from 'react';
import { AgentVersion, api, Connection, Provider, ProviderStatus, Skill } from '../api';
import { CheckGroup, Hint, toLimit } from '../components';
import { useLoad } from '../hooks';

export interface ConfigValues {
  instructions: string;
  provider: Provider;
  model: string;
  skillIds?: string[];
  connectionIds?: string[];
  limits: { maxModelTurns?: number; maxTokens?: number; maxWorkingMinutes?: number };
}

// The versioned part of an agent: instructions, model, skills, connections, and limits. Used
// both to create an agent and to save a new version of one.
export function AgentConfigFields(props: {
  current?: AgentVersion | null;
  onChange: (values: ConfigValues) => void;
}) {
  const providers = useLoad(() => api.get<ProviderStatus[]>('/providers'), []);
  const skills = useLoad(() => api.list<Skill>('/skills?limit=100'), []);
  const connections = useLoad(() => api.list<Connection>('/connections?limit=100'), []);
  const current = props.current;

  const [instructions, setInstructions] = useState(current?.instructions ?? '');
  const [provider, setProvider] = useState<Provider>(current?.provider ?? 'openai');
  const [model, setModel] = useState(current?.model ?? '');
  // Skills are pinned by version, so a skill counts as chosen when its current version is.
  const [skillIds, setSkillIds] = useState<string[] | undefined>();
  const [connectionIds, setConnectionIds] = useState<string[] | undefined>();
  const [turns, setTurns] = useState(String(current?.limits.maxModelTurns ?? ''));
  const [tokens, setTokens] = useState(String(current?.limits.maxTokens ?? ''));
  const [minutes, setMinutes] = useState(String(current?.limits.maxWorkingMinutes ?? ''));

  const enabledSkills = (skills.data?.data ?? []).filter((skill) => !skill.disabledAt);
  const enabledConnections = (connections.data?.data ?? []).filter((c) => !c.disabledAt);
  const chosenSkills =
    skillIds ??
    enabledSkills
      .filter((skill) => current?.skillVersionIds.includes(skill.currentVersionId ?? ''))
      .map((skill) => skill.id);
  const chosenConnections = connectionIds ?? current?.connectionIds ?? [];
  const olderSkillVersions =
    (current?.skillVersionIds.length ?? 0) -
    enabledSkills.filter((s) => current?.skillVersionIds.includes(s.currentVersionId ?? '')).length;

  // Untouched skill and connection lists are left out, so a new version keeps them as they are.
  const report = (changes: Partial<Record<string, unknown>>) => {
    const next = {
      instructions,
      provider,
      model,
      skillIds,
      connectionIds,
      turns,
      tokens,
      minutes,
      ...changes
    } as {
      instructions: string;
      provider: Provider;
      model: string;
      skillIds?: string[];
      connectionIds?: string[];
      turns: string;
      tokens: string;
      minutes: string;
    };
    props.onChange({
      instructions: next.instructions,
      provider: next.provider,
      model: next.model,
      ...(next.skillIds && { skillIds: next.skillIds }),
      ...(next.connectionIds && { connectionIds: next.connectionIds }),
      limits: {
        maxModelTurns: toLimit(next.turns),
        maxTokens: toLimit(next.tokens),
        maxWorkingMinutes: toLimit(next.minutes)
      }
    });
  };
  const ready = providers.data?.find((p) => p.provider === provider);

  return (
    <>
      <label>
        Instructions
        <Hint>
          How the agent should behave: its job, its limits, and its style. For example, "Investigate
          billing issues and cite your sources." Instructions aren't saved notes and aren't
          knowledge sources.
        </Hint>
        <textarea
          className="tall"
          value={instructions}
          onChange={(event) => (
            setInstructions(event.target.value),
            report({ instructions: event.target.value })
          )}
          required
        />
      </label>

      <div className="grid2">
        <label>
          Provider
          <select
            value={provider}
            onChange={(event) => {
              const value = event.target.value as Provider;
              setProvider(value);
              report({ provider: value });
            }}
          >
            {(providers.data ?? []).map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.provider}
                {p.ready ? '' : ' (not set up)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <input
            value={model}
            onChange={(event) => (
              setModel(event.target.value),
              report({ model: event.target.value })
            )}
            placeholder={provider === 'openai' ? 'for example, a small, cheap model' : 'model name'}
            required
          />
        </label>
      </div>
      {ready && <Hint>{ready.ready ? ready.setup : `Not ready yet. ${ready.setup}`}</Hint>}

      <fieldset>
        <legend>Skills</legend>
        <Hint>
          Choosing a skill gives this agent its instructions and tools, and grants access.
        </Hint>
        <CheckGroup
          options={enabledSkills.map((skill) => ({
            value: skill.id,
            label: (
              <>
                <strong>{skill.name}</strong> <span className="muted">{skill.description}</span>
              </>
            )
          }))}
          selected={chosenSkills}
          onChange={(selected) => (setSkillIds(selected), report({ skillIds: selected }))}
        />
        {olderSkillVersions > 0 && !skillIds && (
          <Hint>
            {olderSkillVersions} chosen skill(s) are pinned to an older version. They stay as they
            are unless you change this list.
          </Hint>
        )}
      </fieldset>

      <fieldset>
        <legend>Connections</legend>
        <Hint>
          Outside APIs the agent may call. Each call is still checked, and some need approval.
        </Hint>
        <CheckGroup
          options={enabledConnections.map((connection) => ({
            value: connection.id,
            label: (
              <>
                <strong>{connection.name}</strong>{' '}
                <span className="muted">{connection.description}</span>
              </>
            )
          }))}
          selected={chosenConnections}
          onChange={(selected) => (setConnectionIds(selected), report({ connectionIds: selected }))}
        />
      </fieldset>

      <fieldset>
        <legend>Limits per task</legend>
        <Hint>
          A task stops and asks a person when it reaches one. Leave empty for the default.
        </Hint>
        <div className="grid2">
          <label>
            Model turns
            <input
              inputMode="numeric"
              value={turns}
              onChange={(event) => (
                setTurns(event.target.value),
                report({ turns: event.target.value })
              )}
            />
          </label>
          <label>
            Tokens
            <input
              inputMode="numeric"
              value={tokens}
              onChange={(event) => (
                setTokens(event.target.value),
                report({ tokens: event.target.value })
              )}
            />
          </label>
          <label>
            Working minutes
            <input
              inputMode="numeric"
              value={minutes}
              onChange={(event) => (
                setMinutes(event.target.value),
                report({ minutes: event.target.value })
              )}
            />
          </label>
        </div>
      </fieldset>
    </>
  );
}

// The starting values for a form, before anything is typed.
export function initialConfig(current?: AgentVersion | null): ConfigValues {
  return {
    instructions: current?.instructions ?? '',
    provider: current?.provider ?? 'openai',
    model: current?.model ?? '',
    limits: { ...(current?.limits ?? {}) }
  };
}
