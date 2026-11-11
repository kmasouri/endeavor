<script lang="ts">
  import { api, PROJECT_COLORS, PROJECT_ICONS, type Project } from './api';
  import { createAction } from './state.svelte';
  import ErrorNote from './ErrorNote.svelte';
  import Modal from './Modal.svelte';
  import ProjectGlyph from './ProjectGlyph.svelte';

  let { project = null, onSaved, onClose }: {
    project?: Project | null;
    onSaved: (saved: Project) => void;
    onClose: () => void;
  } = $props();

  const initial = () => project;
  let name = $state(initial()?.name ?? '');
  let icon = $state<NonNullable<Project['icon']>>(initial()?.icon ?? 'folder');
  let color = $state<Project['color']>(initial()?.color ?? null);
  const action = createAction();
  const iconNames = ['Folder', 'Globe', 'Science', 'Code', 'Document', 'Work', 'Tools', 'Idea'];
  const colorName = (value: string) => value[0].toUpperCase() + value.slice(1);
  const changes = $derived({
    ...(!project || name.trim() !== project.name ? { name: name.trim() } : {}),
    ...(icon !== (project?.icon ?? 'folder') ? { icon } : {}),
    ...(color !== (project?.color ?? null) ? { color } : {})
  });

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim() || !Object.keys(changes).length) return;
    void action.run(async () => {
      const saved = project
        ? await api.patch<Project>(`/projects/${project.id}`, changes)
        : await api.post<Project>('/projects', changes);
      onSaved(saved);
    });
  }
</script>

<Modal title={project ? 'Edit project' : 'New project'} busy={action.busy} {onClose}>
  <form class="stack" onsubmit={save}>
    <label>Project name<input bind:value={name} maxlength="100" required disabled={action.busy} /></label>
    <fieldset class="project-appearance">
      <legend>Icon</legend>
      <div class="project-icon-options">
        {#each PROJECT_ICONS as option, index (option)}
          <button type="button" class="quiet icon-button" aria-label={iconNames[index]} title={iconNames[index]} aria-pressed={icon === option} disabled={action.busy} onclick={() => (icon = option)}>
            <ProjectGlyph project={{ icon: option, color }} />
          </button>
        {/each}
      </div>
    </fieldset>
    <fieldset class="project-appearance">
      <legend>Color</legend>
      <div class="project-color-options">
        {#each PROJECT_COLORS as option (option)}
          <button type="button" class="quiet icon-button" aria-label={colorName(option)} title={colorName(option)} aria-pressed={color === option} disabled={action.busy} onclick={() => (color = option)}>
            <span class="project-swatch" data-project-color={option}></span>
          </button>
        {/each}
      </div>
    </fieldset>
    <ErrorNote error={action.error} />
    <footer class="dialog-footer">
      <button type="button" class="secondary" disabled={action.busy} onclick={onClose}>Cancel</button>
      <button disabled={action.busy || !name.trim() || !Object.keys(changes).length}>{project ? 'Save changes' : 'Create project'}</button>
    </footer>
  </form>
</Modal>
