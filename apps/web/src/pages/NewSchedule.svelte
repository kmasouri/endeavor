<script lang="ts">
  import { type Agent, api, type Conversation } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction, createLoad } from '../state.svelte';
  import { getDeviceTimezone, timeDisplay } from '../time-display.svelte';
  import { policyLabels, summarizeRecurrence, formatTimezoneLabel, weekdays } from '../schedules';

  let { onCreated, onDiscard }: { onCreated: () => void; onDiscard: () => void } = $props();
  const agents = createLoad(() => api.list<Agent>('/agents?limit=100'), () => []);
  const conversations = createLoad(() => api.list<Conversation>('/conversations?limit=100'), () => []);
  let agentId = $state('');
  let conversationId = $state('');
  let title = $state('');
  let brief = $state('');
  let criteria = $state('');
  let minutes = $state<number | undefined>(60);
  let frequency = $state<'daily' | 'weekdays' | 'weekly' | 'interval'>('daily');
  let days = $state([1, 3, 5]);
  let time = $state('09:00');
  const timeZone = getDeviceTimezone();
  let policy = $state<'ask' | 'run_once' | 'skip'>('ask');
  let invalid = $derived(frequency === 'weekly' ? !days.length : frequency === 'interval'
    ? !Number.isInteger(minutes) || minutes! < 5 || minutes! > 525600 : !time);
  let recurrence = $derived(frequency === 'interval' ? null : {
    frequency, ...(frequency === 'weekly' && { days }), time, timeZone
  });
  const action = createAction();
  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (invalid) return;
    const ok = await action.run(() => api.post('/responsibilities', {
      agentId, ...(conversationId && { conversationId }), title, brief,
      completionCriteria: criteria,
      ...(recurrence ? { recurrence } : {
        intervalMinutes: minutes,
        // Creating in this form sets up future starts, including for interval schedules.
        startAt: new Date(Date.now() + minutes! * 60000).toISOString()
      }),
      missedRunPolicy: policy
    }));
    if (ok) onCreated();
  }
</script>

<h2 tabindex="-1">New schedule</h2>
<p class="muted small">Creating a schedule sets up future runs. It doesn't start a run now.</p>
<form onsubmit={create} class="schedule-form">
  <label>Title <input bind:value={title} maxlength={200} placeholder="For example, Check the test API" required /></label>
  <label>What to do each time <textarea bind:value={brief} rows={3} placeholder="Tell the agent what to do on every run" required></textarea></label>
  <label>Done when <input bind:value={criteria} placeholder="How the agent knows a run is finished" required /></label>
  <div class="grid2">
    <label>Agent <select bind:value={agentId} required><option value="">Choose an agent…</option>
      {#each agents.data?.data ?? [] as agent (agent.id)}<option value={agent.id}>{agent.name}</option>{/each}
    </select></label>
    <label>Post results in <select bind:value={conversationId}><option value="">Nowhere; see run history</option>
      {#each conversations.data?.data ?? [] as conversation (conversation.id)}<option value={conversation.id}>{conversation.title}</option>{/each}
    </select><span class="muted small">The agent must already be in that conversation.</span></label>
  </div>
  <ErrorNote error={agents.error ?? conversations.error} />
  <fieldset class="schedule-when"><legend>When</legend>
    <label class="schedule-control">Repeat <select bind:value={frequency}>
      <option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="interval">At intervals</option>
    </select></label>
    {#if frequency === 'weekly'}
      <div class="schedule-days" role="group" aria-label="Days of the week">
        {#each weekdays as day, index (day)}<button type="button" class:selected={days.includes(index + 1)} aria-pressed={days.includes(index + 1)} aria-label={day}
          onclick={() => (days = days.includes(index + 1) ? days.filter((day) => day !== index + 1) : [...days, index + 1])}>{day.slice(0, 1)}</button>{/each}
      </div>
      {#if !days.length}<p class="schedule-validation" role="alert">Choose at least one weekday.</p>{/if}
    {/if}
    {#if frequency === 'interval'}
      <label class="schedule-control">Every (minutes) <input type="number" bind:value={minutes} min={5} max={525600} step={1} required /></label>
      {#if invalid}<p class="schedule-validation" role="alert">Use a whole number from 5 to 525600 minutes.</p>{/if}
    {:else}
      <label class="schedule-control">Time <input type="time" bind:value={time} required /></label>
      <p class="muted small">Times are in {formatTimezoneLabel(timeZone)} ({timeZone}), from this computer.</p>
    {/if}
  </fieldset>
  {#if !invalid}<p class="schedule-summary">{summarizeRecurrence({ intervalMinutes: minutes ?? null, recurrence }, timeDisplay.format === '12h')}.</p>{/if}
  <label>If runs are missed <select bind:value={policy}>
    {#each Object.entries(policyLabels) as [value, label] (value)}<option {value}>{label}</option>{/each}
  </select></label>
  <p class="muted small">Schedules need this computer awake and the app running. Calendar runs keep the same source local time when the clocks change. A time skipped by a clock change is skipped; a repeated time runs once.</p>
  <div class="schedule-footer row wrap"><button disabled={action.busy || invalid || !agentId}>Create schedule</button><button type="button" class="secondary" disabled={action.busy} onclick={onDiscard}>Discard</button></div>
  <ErrorNote error={action.error} />
</form>
