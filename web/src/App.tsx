import { FormEvent, useState } from 'react';
import { api, getActorId, Human, setActorId } from './api';
import { ErrorNote } from './components';
import { useAction, useLoad, useRoute } from './hooks';
import { AgentPage } from './pages/Agent';
import { ApprovalsPage } from './pages/Approvals';
import { SchedulesPage } from './pages/Schedules';
import { TaskPage } from './pages/Task';
import { TasksPage } from './pages/Tasks';
import { Approval } from './api';
import { AgentsPage } from './pages/Agents';
import { CatalogsPage } from './pages/Catalogs';
import { ConversationPage } from './pages/Conversation';
import { ConversationsPage } from './pages/Conversations';
import { SetupPage } from './pages/Setup';

export function App() {
  const [actorId, setActor] = useState(getActorId());
  const people = useLoad(() => api.get<Human[]>('/humans'), []);
  const route = useRoute();
  // Shown as a count in the menu, so a waiting approval is hard to miss.
  const pending = useLoad(
    () =>
      actorId
        ? api.list<Approval>('/approvals?status=pending&limit=1')
        : Promise.resolve(undefined),
    [actorId],
    10000
  );

  const choose = (id: string | null) => {
    setActorId(id);
    setActor(id);
  };

  if (people.error) {
    return (
      <main className="narrow">
        <h1>Collaborative Agents</h1>
        <ErrorNote error={`Can't reach the platform: ${people.error}`} />
        <p>Check that it's running (`npm run up`), then reload.</p>
      </main>
    );
  }
  if (!people.data) {
    return <main className="narrow">Loading…</main>;
  }
  if (people.data.length === 0) {
    return <FirstPerson onCreated={(human) => (choose(human.id), people.reload())} />;
  }
  const me = people.data.find((person) => person.id === actorId);
  if (!me) {
    return <PickPerson people={people.data} onPick={choose} />;
  }

  const [section, id] = route;
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          Collaborative Agents
        </a>
        <nav>
          <a className={!section || section === 'conversations' ? 'active' : ''} href="#/">
            Conversations
          </a>
          <a className={section === 'tasks' ? 'active' : ''} href="#/tasks">
            Work
          </a>
          <a className={section === 'approvals' ? 'active' : ''} href="#/approvals">
            Approvals
            {pending.data && pending.data.page.total > 0 && ` (${pending.data.page.total})`}
          </a>
          <a className={section === 'schedules' ? 'active' : ''} href="#/schedules">
            Schedules
          </a>
          <a className={section === 'agents' ? 'active' : ''} href="#/agents">
            Agents
          </a>
          <a className={section === 'catalogs' ? 'active' : ''} href="#/catalogs">
            Skills and connections
          </a>
          <a className={section === 'setup' ? 'active' : ''} href="#/setup">
            Setup
          </a>
        </nav>
        <label className="acting-as">
          Acting as
          <select value={me.id} onChange={(event) => choose(event.target.value)}>
            {people.data.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main>
        {section === 'setup' ? (
          <SetupPage people={people.data} onPeopleChanged={people.reload} />
        ) : section === 'tasks' && id ? (
          <TaskPage taskId={id} />
        ) : section === 'tasks' ? (
          <TasksPage />
        ) : section === 'approvals' ? (
          <ApprovalsPage />
        ) : section === 'schedules' ? (
          <SchedulesPage />
        ) : section === 'agents' && id ? (
          <AgentPage agentId={id} />
        ) : section === 'agents' ? (
          <AgentsPage />
        ) : section === 'catalogs' ? (
          <CatalogsPage />
        ) : section === 'conversations' && id ? (
          <ConversationPage conversationId={id} me={me} />
        ) : (
          <ConversationsPage />
        )}
      </main>
    </div>
  );
}

function FirstPerson({ onCreated }: { onCreated: (human: Human) => void }) {
  const [name, setName] = useState('');
  const action = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => onCreated(await api.post<Human>('/humans', { name })));
  };
  return (
    <main className="narrow">
      <h1>Welcome</h1>
      <p>
        This platform runs on your computer. Agents' tools run here too, but the AI models they use
        are called over the internet with your API key. Agents only make progress while this
        computer is awake and the platform is running.
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          Your name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <button disabled={action.busy || !name.trim()}>Get started</button>
        <ErrorNote error={action.error} />
      </form>
    </main>
  );
}

function PickPerson({ people, onPick }: { people: Human[]; onPick: (id: string) => void }) {
  return (
    <main className="narrow">
      <h1>Who are you?</h1>
      <p className="muted">
        There's no sign-in yet. Pick yourself; this browser remembers the choice.
      </p>
      <ul className="choices">
        {people.map((person) => (
          <li key={person.id}>
            <button onClick={() => onPick(person.id)}>{person.name}</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
