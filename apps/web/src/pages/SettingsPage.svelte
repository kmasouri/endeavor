<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type Human } from '../api';
  import Avatar from '../Avatar.svelte';
  import PageHeader from '../PageHeader.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { createProfileEditor } from '../profile-state.svelte';
  import { deviceTimezone, shortTime } from '../time-display.svelte';
  import './settings.css';

  let {
    person,
    onSaved,
    onGuard,
    onDirty
  }: {
    person: Human;
    onSaved: (person: Human) => void;
    onGuard: (guard: () => boolean) => void;
    onDirty: (dirty: boolean) => void;
  } = $props();
  // The parent keys this page by person, so a person switch always starts a fresh draft.
  const editor = createProfileEditor(
    untrack(() => person),
    (input) => api.patch<Human>('/humans/me', input),
    (updated) => onSaved(updated)
  );
  let tab = $state<'profile' | 'preferences'>('profile');
  let previewName = $derived(editor.name.trim() || 'Your name');
  let dirty = $derived(tab === 'profile' ? editor.profileDirty : editor.preferencesDirty);
  const previewInstant = new Date().toISOString();
  const timezone = deviceTimezone();
  $effect(() => {
    onDirty(editor.dirty || editor.busy);
  });
  $effect(() => {
    onGuard(() =>
      editor.canLeave(() => window.confirm('Discard your unsaved profile and settings changes?'))
    );
    return () => {
      onGuard(() => true);
      onDirty(false);
    };
  });
</script>

<PageHeader
  title="Profile and settings"
  subtitle="A few things to make this workspace feel like yours."
/>
<div class="settings-page">
  <nav class="settings-tabs" aria-label="Settings">
    <button
      class:chosen={tab === 'profile'}
      aria-current={tab === 'profile' ? 'page' : undefined}
      onclick={() => (tab = 'profile')}>Profile</button
    >
    <button
      class:chosen={tab === 'preferences'}
      aria-current={tab === 'preferences' ? 'page' : undefined}
      onclick={() => (tab = 'preferences')}>Preferences</button
    >
  </nav>
  <form
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      void editor.save(tab);
    }}
  >
    <fieldset class="settings-fields" disabled={editor.busy}>
      {#if tab === 'profile'}
        <div class="row settings-person">
          <Avatar name={previewName} id={person.id} size="xl" />
          <div class="settings-person-copy">
            <strong>{previewName}</strong><span class="muted small"
              >This is how you appear in conversations.</span
            >
          </div>
        </div>
        <label class="settings-name" for="display-name">
          <strong>Display name</strong>
          <input
            id="display-name"
            bind:value={editor.name}
            aria-invalid={Boolean(editor.nameError)}
            aria-describedby={editor.nameError ? 'name-error name-help' : 'name-help'}
            autocomplete="nickname"
          />
          <span id="name-help" class="muted small">Use a name your teammates will recognize.</span>
        </label>
        {#if editor.nameError}<p id="name-error" class="error" role="alert">
            {editor.nameError}
          </p>{/if}
        <div class="settings-preview">
          <span class="label">In a conversation</span>
          <div class="settings-message row">
            <Avatar name={previewName} id={person.id} size="lg" />
            <div>
              <div class="row wrap">
                <strong>{previewName}</strong><span class="caption muted"
                  >{shortTime(previewInstant)}</span
                >
              </div>
              <p>Let's take a look at the latest draft.</p>
            </div>
          </div>
        </div>
      {:else}
        <section class="settings-section">
          <div>
            <h2>Appearance</h2>
            <p class="muted small">Choose how the app looks for you.</p>
          </div>
          <fieldset class="theme-choices">
            <legend class="sr-only">Theme</legend>
            {#each [['system', 'Match this computer'], ['dark', 'Dark'], ['light', 'Light']] as [value, label] (value)}
              <label class="theme-choice" class:chosen={editor.theme === value}>
                <input type="radio" name="theme" {value} bind:group={editor.theme} />
                <span>{label}</span>
              </label>
            {/each}
          </fieldset>
        </section>
        <section class="settings-section settings-time">
          <div>
            <h2>Dates and time</h2>
            <p class="muted small">See messages and schedule runs in your local time.</p>
          </div>
          <div class="row wrap">
            <div class="grow">
              <span>{timezone}</span><span class="caption muted">From this computer</span>
            </div>
            <span class="badge">Found automatically</span>
          </div>
          <div class="settings-time-format">
            <label for="time-format">Time format</label>
            <select id="time-format" bind:value={editor.timeFormat}>
              <option value="12h">12-hour · 9:31 PM</option><option value="24h"
                >24-hour · 21:31</option
              >
            </select>
          </div>
          <p class="muted small">
            This changes how times are shown. Schedules keep the time zone they were made in.
          </p>
        </section>
      {/if}
    </fieldset>
    <ErrorNote
      error={editor.error && editor.feedbackSection === tab
        ? `Couldn't save. ${editor.error} Your edits are kept; try Save again.`
        : null}
    />
    <div class="settings-actions">
      <span class="muted small grow" role="status"
        >{editor.busy
          ? 'Saving…'
          : (editor.feedbackSection === tab && editor.success) ||
            (dirty ? 'Unsaved changes' : 'No changes')}</span
      >
      <button
        type="button"
        class="secondary"
        disabled={!dirty || editor.busy}
        onclick={() => editor.discard(tab)}>Discard</button
      >
      <button
        type="submit"
        disabled={!dirty || editor.busy || (tab === 'profile' && Boolean(editor.nameError))}
      >
        {tab === 'profile' ? 'Save profile' : 'Save preferences'}
      </button>
    </div>
  </form>
</div>
