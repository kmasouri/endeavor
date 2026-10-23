import { FormEvent, useState } from 'react';
import { AgentNote, api, ConversationDocument } from '../api';
import { CONTEXT_LABELS, ErrorNote, Hint, when } from '../components';
import { useAction, useLoad } from '../hooks';
import { useNames } from '../names';

// What "context" means, shown wherever people configure or inspect it.
export function ContextExplainer() {
  return (
    <details>
      <summary>What goes into an agent's context?</summary>
      <p className="small">
        <strong>Context</strong> is what the model is given for its current turn. It isn't a
        permanent store. It can include:
      </p>
      <ul className="small">
        <li>
          <strong>Instructions:</strong> {CONTEXT_LABELS.instructions}
        </li>
        <li>
          <strong>Knowledge sources:</strong> {CONTEXT_LABELS.knowledge}
        </li>
        <li>
          <strong>Conversation history:</strong> {CONTEXT_LABELS.history}
        </li>
        <li>
          <strong>Saved notes (agent memory):</strong> {CONTEXT_LABELS.notes}
        </li>
      </ul>
    </details>
  );
}

// An agent's saved notes, with where each came from. People can fix or delete them; that never
// changes the agent's instructions or any source document.
export function SavedNotes({ agentId }: { agentId: string }) {
  const notes = useLoad(() => api.list<AgentNote>(`/agents/${agentId}/notes?limit=200`), [agentId]);
  const name = useNames();

  return (
    <>
      <h2>Saved notes (agent memory)</h2>
      <Hint>{CONTEXT_LABELS.notes}</Hint>
      <ContextExplainer />
      <ErrorNote error={notes.error} />
      {notes.data?.data.length === 0 && <p className="muted">No saved notes.</p>}
      <ul className="list">
        {(notes.data?.data ?? []).map((note) => (
          <NoteRow
            key={note.id}
            agentId={agentId}
            note={note}
            name={name}
            onChanged={notes.reload}
          />
        ))}
      </ul>
    </>
  );
}

function NoteRow(props: {
  agentId: string;
  note: AgentNote;
  name: (actor: { type: string; id: string | null }) => string;
  onChanged: () => void;
}) {
  const n = props.note;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(n.body);
  const action = useAction();
  const path = `/agents/${props.agentId}/notes/${n.id}`;
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.patch(path, { body }))
      .then((ok) => ok && (setEditing(false), props.onChanged()));
  };

  return (
    <li>
      {editing ? (
        <form onSubmit={save} className="stack">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          <div className="row">
            <button disabled={action.busy}>Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="body">{n.body}</p>
      )}
      <div className="muted small">
        Written by {props.name(n.createdBy)} {when(n.createdAt)}
        {n.sourceConversationId && (
          <>
            {' '}
            in <a href={`#/conversations/${n.sourceConversationId}`}>a conversation</a>
          </>
        )}
        {n.sourceTaskId && (
          <>
            {' '}
            during <a href={`#/tasks/${n.sourceTaskId}`}>a task</a>
          </>
        )}
        {n.updatedByHumanId &&
          ` · corrected by ${props.name({ type: 'human', id: n.updatedByHumanId })}`}
        {' · '}
        {n.scope === 'agent' ? 'used in all its work' : 'used only in that conversation'}
      </div>
      {!editing && (
        <div className="row wrap">
          <button className="secondary" onClick={() => setEditing(true)}>
            Correct
          </button>
          <button
            className="secondary"
            disabled={action.busy}
            onClick={() =>
              void action
                .run(() =>
                  api.patch(path, { scope: n.scope === 'agent' ? 'conversation' : 'agent' })
                )
                .then(props.onChanged)
            }
          >
            {n.scope === 'agent' ? 'Use only in its conversation' : 'Use in all its work'}
          </button>
          <button
            className="secondary"
            disabled={action.busy}
            onClick={() =>
              confirm('Delete this note?') &&
              void action.run(() => api.delete(path)).then(props.onChanged)
            }
          >
            Delete
          </button>
        </div>
      )}
      <ErrorNote error={action.error} />
    </li>
  );
}

// Documents people attach to a conversation for its agents to use.
export function KnowledgeSources({ conversationId }: { conversationId: string }) {
  const docs = useLoad(
    () => api.get<ConversationDocument[]>(`/conversations/${conversationId}/documents`),
    [conversationId]
  );
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const action = useAction();
  const add = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(`/conversations/${conversationId}/documents`, { title, content }))
      .then((ok) => ok && (setTitle(''), setContent(''), docs.reload()));
  };

  return (
    <>
      <h2>Knowledge sources</h2>
      <Hint>{CONTEXT_LABELS.knowledge} Agents here can use these.</Hint>
      <ErrorNote error={docs.error} />
      <ul className="list">
        {(docs.data ?? []).length === 0 && <li className="muted">None attached.</li>}
        {(docs.data ?? []).map((doc) => (
          <li key={doc.id} className="row">
            <details className="grow">
              <summary>{doc.title}</summary>
              <pre>{doc.content}</pre>
            </details>
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() =>
                void action
                  .run(() => api.delete(`/conversations/${conversationId}/documents/${doc.id}`))
                  .then(docs.reload)
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <details>
        <summary>Attach a document</summary>
        <form onSubmit={add} className="stack">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            required
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder="Paste the text"
            required
          />
          <button disabled={action.busy}>Attach</button>
        </form>
      </details>
      <ErrorNote error={action.error} />
    </>
  );
}
