<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { api, type SkillDetails, type Connection } from '../api';
  import { createLoad } from '../state.svelte';
  import DiscoverableToggle from './DiscoverableToggle.svelte';
  import EnableButton from './EnableButton.svelte';
  import SkillVersionForm from './SkillVersionForm.svelte';
  import ConnectionConfiguration from './ConnectionConfiguration.svelte';
  import './creation.css';
  import '../management.css';
  let { kind, entryId }: { kind: 'skills' | 'connections'; entryId: string } = $props();
  const entry = createLoad<SkillDetails | Connection>(() => kind === 'skills' ? api.get<SkillDetails>(`/skills/${entryId}`) : api.get<Connection>(`/connections/${entryId}`), () => [kind, entryId]);
  const title = $derived(kind === 'skills' ? 'Skills' : 'Connections');
</script>
<div class="creation-page">
  <a class="creation-back" href={`#/${kind}`}>← {title}</a>
  <ErrorNote error={entry.error} />
  {#if !entry.data && !entry.error}<p class="muted">Loading configuration…</p>{/if}
  {#if entry.data}
    <PageHeader title={entry.data.name} subtitle={entry.data.description}>
      {#snippet actions()}<span class="management-status" class:enabled={!entry.data?.disabledAt}>{entry.data?.disabledAt ? 'Disabled' : 'Enabled'}</span>{/snippet}
    </PageHeader>
    <div class="creation-form">
      {#if 'baseUrl' in entry.data}
        <ConnectionConfiguration connection={entry.data} onChanged={entry.reload} />
      {:else}
        <div class="row"><h2 class="grow">Instructions</h2><EnableButton path={`/skills/${entryId}`} disabled={!!entry.data?.disabledAt} onChanged={entry.reload} /></div>
        <DiscoverableToggle path={`/skills/${entryId}`} discoverable={entry.data.discoverable} onChanged={entry.reload} />
        {#key entry.data.currentVersionId}<SkillVersionForm skill={entry.data} onSaved={entry.reload} />{/key}
      {/if}
    </div>
  {/if}
</div>
