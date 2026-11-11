<script lang="ts">
  import type { Project } from './api';

  let { project }: { project?: Pick<Project, 'icon' | 'color'> | null } = $props();
</script>

<span class="project-glyph" data-project-color={project?.color ?? undefined} aria-hidden="true">
  {project?.icon ?? 'folder'}
</span>
