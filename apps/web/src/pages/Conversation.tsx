import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ConversationDetails,
  DirectoryEntry,
  Human,
  Task,
  TaskOutput,
  Member,
  Message,
  ParticipantRef
} from '../api';
import { ErrorNote, Hint, when } from '../components';
import { useAction, useLoad } from '../hooks';
import { ContextExplainer, KnowledgeSources } from './Context';
import { Spending } from './Spending';

const SUGGESTION = /^Suggestion: add (.+?) \(/;

export function ConversationPage({ conversationId, me }: { conversationId: string; me: Human }) {
  const details = useLoad(
    () => api.get<ConversationDetails>(`/conversations/${conversationId}`),
    [conversationId]
  );
  // Reloads every few seconds, so agents' replies show up on their own.
  const messages = useLoad(
    () => api.list<Message>(`/conversations/${conversationId}/messages?limit=500`),
    [conversationId],
    2500
  );
  const directory = useLoad(() => api.get<DirectoryEntry[]>('/directory'), []);

  if (details.error) {
    return <ErrorNote error={details.error} />;
  }
  if (!details.data) {
    return <p>Loading…</p>;
  }
  const conversation = details.data;
  const nameOf = (ref: { type: string; id: string | null }) =>
    conversation.members.find((m) => m.participant.type === ref.type && m.participant.id === ref.id)
      ?.name ?? (ref.type === 'system' ? 'Platform' : 'Someone');

  return (
    <div className="columns">
      <section className="thread">
        <h1>{conversation.title}</h1>
        <Hint>
          Agents answer when you mention them. This is the conversation history: agents see the part
          they're allowed to. Closing this page doesn't stop agents' work.
        </Hint>
        <ErrorNote error={messages.error} />
        <MessageList
          messages={messages.data?.data ?? []}
          nameOf={nameOf}
          members={conversation.members}
          directory={directory.data ?? []}
          onAdd={(agentId) =>
            api
              .post(`/conversations/${conversationId}/members`, { type: 'agent', id: agentId })
              .then(details.reload)
          }
        />
        <Composer
          conversationId={conversationId}
          members={conversation.members}
          messages={messages.data?.data ?? []}
          nameOf={nameOf}
          onPosted={messages.reload}
        />
      </section>

      <aside>
        <div className="panel">
          <ConversationTasks conversationId={conversationId} />
        </div>
        <div className="panel">
          <ConversationOutputs conversationId={conversationId} />
        </div>
        <div className="panel">
          <Spending kind="conversation" id={conversationId} />
        </div>
        <div className="panel">
          <KnowledgeSources conversationId={conversationId} />
          <ContextExplainer />
        </div>
        <div className="panel">
          <Members
            conversationId={conversationId}
            me={me}
            members={conversation.members}
            directory={directory.data ?? []}
            onChanged={details.reload}
          />
        </div>
      </aside>
    </div>
  );
}

function MessageList(props: {
  messages: Message[];
  nameOf: (ref: { type: string; id: string | null }) => string;
  members: Member[];
  directory: DirectoryEntry[];
  onAdd: (agentId: string) => Promise<unknown>;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = props.messages.length;
  // Braces matter: React treats anything an effect returns as its cleanup, and newer browsers
  // return a Promise from scrollIntoView(). Calling that on leaving the page blanked the app.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  const byId = useMemo(() => new Map(props.messages.map((m) => [m.id, m])), [props.messages]);

  if (count === 0) {
    return <p className="muted">No messages yet. Say hello, and mention an agent to ask it.</p>;
  }
  return (
    <ol className="messages">
      {props.messages.map((message) => {
        const replyTo = message.inReplyToMessageId ? byId.get(message.inReplyToMessageId) : null;
        return (
          <li key={message.id} id={`m-${message.id}`} className={`message ${message.authorType}`}>
            <div className="meta">
              <strong>{props.nameOf({ type: message.authorType, id: message.authorId })}</strong>
              <span className="muted">{when(message.createdAt)}</span>
              {message.taskId && <a href={`#/tasks/${message.taskId}`}>task</a>}
              {message.mentions.length > 0 && (
                <span className="muted">
                  to {message.mentions.map((ref) => props.nameOf(ref)).join(', ')}
                </span>
              )}
            </div>
            {replyTo && (
              <div className="reply-to muted">
                Replying to {props.nameOf({ type: replyTo.authorType, id: replyTo.authorId })}:{' '}
                {replyTo.body.slice(0, 80)}
              </div>
            )}
            <div className="body">{message.body}</div>
            <Suggestion message={message} {...props} />
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}

// Agents can't add anyone. When one suggests a specialist, a person adds it with one click.
function Suggestion(props: {
  message: Message;
  members: Member[];
  directory: DirectoryEntry[];
  onAdd: (agentId: string) => Promise<unknown>;
}) {
  const action = useAction();
  const name = props.message.authorType === 'agent' && SUGGESTION.exec(props.message.body)?.[1];
  const agent = name ? props.directory.find((entry) => entry.name === name) : undefined;
  if (!agent) {
    return null;
  }
  const added = props.members.some((m) => m.participant.id === agent.id);
  return (
    <div className="suggestion">
      {added ? (
        <span className="muted">{agent.name} is in this conversation.</span>
      ) : (
        <button disabled={action.busy} onClick={() => void action.run(() => props.onAdd(agent.id))}>
          Add {agent.name}
        </button>
      )}
      <ErrorNote error={action.error} />
    </div>
  );
}

function Composer(props: {
  conversationId: string;
  members: Member[];
  messages: Message[];
  nameOf: (ref: { type: string; id: string | null }) => string;
  onPosted: () => void;
}) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<ParticipantRef[]>([]);
  const [replyTo, setReplyTo] = useState('');
  const action = useAction();
  const agents = props.members.filter((m) => m.participant.type === 'agent');
  const recent = props.messages.slice(-10).reverse();

  const toggle = (ref: ParticipantRef) =>
    setMentions((list) =>
      list.some((x) => x.id === ref.id) ? list.filter((x) => x.id !== ref.id) : [...list, ref]
    );

  const send = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() =>
        api.post(`/conversations/${props.conversationId}/messages`, {
          body,
          mentions,
          ...(replyTo && { inReplyToMessageId: replyTo }),
          clientKey: crypto.randomUUID()
        })
      )
      .then((ok) => {
        if (ok) {
          setBody('');
          setReplyTo('');
          props.onPosted();
        }
      });
  };

  return (
    <form onSubmit={send} className="composer stack">
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a message. Add context, ask a question, or redirect the work."
        rows={3}
        required
      />
      <div className="row wrap">
        <span className="muted">Ask:</span>
        {agents.length === 0 && <span className="muted">no agents here yet</span>}
        {agents.map((member) => (
          <label key={member.participant.id} className="chip">
            <input
              type="checkbox"
              checked={mentions.some((x) => x.id === member.participant.id)}
              onChange={() => toggle(member.participant)}
            />
            {member.name}
          </label>
        ))}
      </div>
      <div className="row wrap">
        <label className="grow">
          <span className="muted">In reply to </span>
          <select value={replyTo} onChange={(event) => setReplyTo(event.target.value)}>
            <option value="">(nothing)</option>
            {recent.map((message) => (
              <option key={message.id} value={message.id}>
                {props.nameOf({ type: message.authorType, id: message.authorId })}:{' '}
                {message.body.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <button disabled={action.busy || !body.trim()}>Send</button>
      </div>
      {mentions.length === 0 && body.trim() && (
        <Hint>No one is mentioned, so this message starts no work.</Hint>
      )}
      <ErrorNote error={action.error} />
    </form>
  );
}

function Members(props: {
  conversationId: string;
  me: Human;
  members: Member[];
  directory: DirectoryEntry[];
  onChanged: () => void;
}) {
  const people = useLoad(() => api.get<Human[]>('/humans'), []);
  const [choice, setChoice] = useState('');
  const [history, setHistory] = useState<'all' | 'from_now'>('all');
  const action = useAction();
  const inside = new Set(props.members.map((m) => m.participant.id));
  const agentChoices = props.directory.filter((agent) => !inside.has(agent.id));
  const peopleChoices = (people.data ?? []).filter((person) => !inside.has(person.id));

  const add = (event: FormEvent) => {
    event.preventDefault();
    const [type, id] = choice.split(':');
    void action
      .run(() => api.post(`/conversations/${props.conversationId}/members`, { type, id, history }))
      .then((ok) => ok && (setChoice(''), props.onChanged()));
  };

  return (
    <>
      <h2>Members</h2>
      <ul className="list">
        {props.members.map((member) => (
          <li key={member.participant.id}>
            <strong>{member.name}</strong>
            <span className="muted">
              {' '}
              · {member.participant.type === 'agent' ? 'agent' : 'person'}
              {member.participant.id === props.me.id && ' (you)'}
            </span>
            {member.purpose && <div className="muted small">{member.purpose}</div>}
            {member.historyFrom && (
              <div className="muted small">Sees messages from {when(member.historyFrom)}</div>
            )}
          </li>
        ))}
      </ul>

      <h3>Add someone</h3>
      <Hint>
        Only people add members. An added agent can read the conversation history you allow, but
        never other conversations or anyone's credentials.
      </Hint>
      <form onSubmit={add} className="stack">
        <select value={choice} onChange={(event) => setChoice(event.target.value)} required>
          <option value="">Choose…</option>
          {agentChoices.length > 0 && (
            <optgroup label="Agents (directory)">
              {agentChoices.map((agent) => (
                <option key={agent.id} value={`agent:${agent.id}`}>
                  {agent.name}: {agent.purpose}
                </option>
              ))}
            </optgroup>
          )}
          {peopleChoices.length > 0 && (
            <optgroup label="People">
              {peopleChoices.map((person) => (
                <option key={person.id} value={`human:${person.id}`}>
                  {person.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={history === 'from_now'}
            onChange={(event) => setHistory(event.target.checked ? 'from_now' : 'all')}
          />
          Hide earlier messages from them
        </label>
        <button disabled={action.busy || !choice}>Add</button>
        <ErrorNote error={action.error} />
      </form>
    </>
  );
}

function ConversationTasks({ conversationId }: { conversationId: string }) {
  const tasks = useLoad(
    () => api.list<Task>(`/tasks?conversationId=${conversationId}&limit=20`),
    [conversationId],
    4000
  );
  const open = (tasks.data?.data ?? []).filter(
    (t) => t.state !== 'completed' && t.state !== 'cancelled'
  );
  return (
    <>
      <h2>Work here</h2>
      {(tasks.data?.data ?? []).length === 0 && <p className="muted">No tasks yet.</p>}
      <ul className="list small">
        {(open.length > 0 ? open : (tasks.data?.data ?? []).slice(0, 5)).map((task) => (
          <li key={task.id}>
            <a href={`#/tasks/${task.id}`}>{task.title}</a>{' '}
            <span className={`badge state-${task.state}`}>{task.state}</span>
            {task.pausedAt && <span className="badge"> paused</span>}
          </li>
        ))}
      </ul>
      {open.length === 0 && (tasks.data?.data ?? []).length > 0 && (
        <p className="muted small">Nothing open. Showing the latest.</p>
      )}
    </>
  );
}

// Results and evidence from every task here, newest first.
function ConversationOutputs({ conversationId }: { conversationId: string }) {
  const outputs = useLoad(
    () =>
      api.list<TaskOutput & { taskId: string }>(
        `/conversations/${conversationId}/outputs?limit=20`
      ),
    [conversationId],
    5000
  );
  const list = outputs.data?.data ?? [];
  return (
    <>
      <h2>Outputs</h2>
      <Hint>
        Results and evidence agents attached here. Ask in the thread to question or revise one.
      </Hint>
      {list.length === 0 && <p className="muted">None yet.</p>}
      <ul className="list small">
        {list.map((output) => (
          <li key={output.id}>
            <details>
              <summary>
                {output.title} <span className="badge">{output.kind}</span>
              </summary>
              {output.uri && <div className="muted">{output.uri}</div>}
              {output.content && <pre>{output.content}</pre>}
              <a href={`#/tasks/${output.taskId}`}>Open the task</a>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
