import { FormEvent, useState } from 'react';
import { api, Human } from '../api';
import { ErrorNote } from '../components';
import { useAction } from '../hooks';

export function SetupPage({
  people,
  onPeopleChanged
}: {
  people: Human[];
  onPeopleChanged: () => void;
}) {
  const [name, setName] = useState('');
  const action = useAction();

  const add = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post('/humans', { name }))
      .then((ok) => ok && (setName(''), onPeopleChanged()));
  };

  return (
    <div className="narrow">
      <h1>Setup</h1>

      <section className="panel">
        <h2>How this runs</h2>
        <ul>
          <li>
            <strong>Everything runs on this computer:</strong> conversations, agents' work,
            schedules, and agents' tools. Agents' files stay in a private folder for each task.
          </li>
          <li>
            <strong>The AI models don't.</strong> Agents call them over the internet with the API
            key in your <code>.env</code> file, and connections reach the services you set up.
          </li>
          <li>
            <strong>Keep it awake.</strong> Agents only make progress while this computer is on,
            awake, and the platform is running. After a restart, work picks up where it left off.
          </li>
          <li>
            <strong>Closing this page doesn't stop anything.</strong> Work runs in the background,
            not in the browser.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>People</h2>
        <p className="muted">
          For now there's one role: everyone can do everything. There's no sign-in, so only this
          computer can reach the platform.
        </p>
        <ul className="list">
          {people.map((person) => (
            <li key={person.id}>{person.name}</li>
          ))}
        </ul>
        <form onSubmit={add} className="row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            required
          />
          <button disabled={action.busy || !name.trim()}>Add person</button>
        </form>
        <ErrorNote error={action.error} />
      </section>
    </div>
  );
}
