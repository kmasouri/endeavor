import { FormEvent, useState } from 'react';
import { api, CostReport } from '../api';
import { ErrorNote, Hint } from '../components';
import { useAction, useLoad } from '../hooks';

const money = (amount: number) => `$${amount.toFixed(2)}`;

// Spending and the budget for an agent (per month) or a conversation (in total).
export function Spending(props: {
  kind: 'agent' | 'conversation';
  id: string;
  onBudgetSaved?: () => void;
}) {
  const base = props.kind === 'agent' ? `/agents/${props.id}` : `/conversations/${props.id}`;
  const report = useLoad(() => api.get<CostReport>(`${base}/costs`), [base], 15000);
  const [budget, setBudget] = useState('');
  const action = useAction();
  const field = props.kind === 'agent' ? 'monthlyBudgetUsd' : 'budgetUsd';
  const r = report.data;
  const spent = props.kind === 'agent' ? r?.thisMonth : r?.total;

  const save = (value: number | null) =>
    void action
      .run(() => api.patch(base, { [field]: value }))
      .then((ok) => ok && (setBudget(''), report.reload(), props.onBudgetSaved?.()));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save(Number(budget));
  };

  return (
    <>
      <h2>Spending</h2>
      <Hint>
        {props.kind === 'agent'
          ? 'What this agent spent on AI models, this month (UTC) and in total. When it reaches its monthly budget, its work stops and asks a person.'
          : 'What all agent work here spent on AI models. When it reaches the budget, agents here stop and ask a person.'}
      </Hint>
      <ErrorNote error={report.error} />
      {r && spent && (
        <>
          <p>
            <strong>{money(spent.costUsd)}</strong>
            {props.kind === 'agent' && ` this month · ${money(r.total.costUsd)} in total`}
            {r.budgetUsd !== null && (
              <span className={spent.costUsd >= r.budgetUsd ? 'error' : 'muted'}>
                {' '}
                of a {money(r.budgetUsd)} budget
              </span>
            )}
            <span className="muted small"> · {spent.tokens.toLocaleString()} tokens</span>
          </p>
          {spent.unpricedCalls > 0 && (
            <Hint>
              {spent.unpricedCalls} model call(s) have no price, so they aren't in the total. Add
              the model to MODEL_PRICES to count them.
            </Hint>
          )}
          {r.tasks.length > 0 && (
            <details>
              <summary>Costliest tasks</summary>
              <ul className="list small">
                {r.tasks.map((t) => (
                  <li key={t.taskId}>
                    <a href={`#/tasks/${t.taskId}`}>{t.title}</a> · {money(t.costUsd)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <form onSubmit={submit} className="row wrap">
        <input
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder={props.kind === 'agent' ? 'Monthly budget, $' : 'Budget, $'}
          style={{ width: '10rem' }}
        />
        <button disabled={action.busy || !(Number(budget) > 0)}>Set budget</button>
        {r?.budgetUsd !== null && r?.budgetUsd !== undefined && (
          <button
            type="button"
            className="secondary"
            disabled={action.busy}
            onClick={() => save(null)}
          >
            Remove budget
          </button>
        )}
      </form>
      <ErrorNote error={action.error} />
    </>
  );
}
