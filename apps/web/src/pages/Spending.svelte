<script lang="ts">
  import { api, type CostReport } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction, createLoad } from '../state.svelte';

  const formatMoney = (amount: number) => `$${amount.toFixed(2)}`;

  let props: {
    kind: 'agent' | 'conversation';
    id: string;
    onBudgetSaved?: () => void;
  } = $props();
  let base = $derived(
    props.kind === 'agent' ? `/agents/${props.id}` : `/conversations/${props.id}`
  );
  const report = createLoad(
    () => api.get<CostReport>(`${base}/costs`),
    () => [base],
    15000
  );
  let editing = $state(false);
  let budget = $state('');
  const action = createAction();
  let field = $derived(props.kind === 'agent' ? 'monthlyBudgetUsd' : 'budgetUsd');
  let costReport = $derived(report.data);
  let spent = $derived(props.kind === 'agent' ? costReport?.thisMonth : costReport?.total);
  const save = (value: number | null) =>
    void action
      .run(() => api.patch(base, { [field]: value }))
      .then((ok) => ok && ((budget = ''), report.reload(), props.onBudgetSaved?.()));
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    save(Number(budget));
  };
</script>

<h2>Spending</h2>

{#if props.kind === 'agent'}
  <Hint>
    What this agent spent on AI models, this month (UTC) and in total. When it reaches its monthly
    budget, its work stops and asks a person.
  </Hint>
{/if}

<ErrorNote error={report.error} />

{#if costReport && spent}
  <p>
    <strong>{formatMoney(spent.costUsd)}</strong>

    {#if props.kind === 'agent'}{` this month · ${formatMoney(costReport.total.costUsd)} in total`}{/if}

    {#if costReport.budgetUsd !== null}
      <span class={spent.costUsd >= costReport.budgetUsd ? 'error' : 'muted'}>
        of a {formatMoney(costReport.budgetUsd)} budget
      </span>
    {/if}
    <span class="muted small"> · {spent.tokens.toLocaleString()} tokens</span>
  </p>

  {#if spent.unpricedCalls > 0}
    <Hint>
      {spent.unpricedCalls} model call(s) have no price, so they aren't in the total. Add the model to
      MODEL_PRICES to count them.
    </Hint>
  {/if}

  {#if props.kind === 'agent' && costReport.tasks.length > 0}
    <details>
      <summary>Costliest tasks</summary>

      <ul class="list small">
        {#each costReport.tasks ?? [] as taskCost (taskCost.taskId)}
          <li>
            <a href={`#/tasks/${taskCost.taskId}`}>{taskCost.title}</a>
            · {formatMoney(taskCost.costUsd)}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
{/if}

{#if props.kind === 'conversation'}
  {#if costReport && spent && costReport.budgetUsd !== null}<progress
      aria-label="Conversation spending"
      value={spent.costUsd}
      max={costReport.budgetUsd}
    ></progress>{/if}
  <button class="text-button" onclick={() => (editing = !editing)}
    >Change this conversation's budget</button
  >
{/if}
{#if props.kind === 'agent' || editing}
  <form onsubmit={submit} class="row wrap">
    <input
      inputmode="decimal"
      bind:value={budget}
      placeholder={props.kind === 'agent' ? 'Monthly budget, $' : 'Budget, $'}
      style="width: 10rem"
    />
    <button disabled={action.busy || !(Number(budget) > 0)}>Set budget</button>

    {#if costReport?.budgetUsd !== null && costReport?.budgetUsd !== undefined}
      <button type="button" class="secondary" disabled={action.busy} onclick={() => save(null)}>
        Remove budget
      </button>
    {/if}
  </form>
{/if}

<ErrorNote error={action.error} />
