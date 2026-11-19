<script lang="ts">
  import { type Task, type TaskOutput } from '../api';
  import { toSafeHref } from '../message-format';
  import FormattedText from '../FormattedText.svelte';
  import { formatDateTime, formatShortTime } from '../components';
  import Icon from '../Icon.svelte';
  import ReviewPanel from './ReviewPanel.svelte';
  let {
    output,
    task,
    cost,
    onReply,
    onChanged,
    onInspect
  }: {
    output: TaskOutput;
    task?: Task;
    cost?: number;
    onReply: () => void;
    onChanged: () => void;
    onInspect?: (id: string) => void;
  } = $props();
  let pendingReview = $derived(
    task?.reviewRequired && task.state === 'waiting' && task.criteriaCheck && !task.review
  );
  let reading = $state(false);
  let duration = $derived(
    task?.finishedAt
      ? Math.max(0, Math.round((Date.parse(task.finishedAt) - Date.parse(task.createdAt)) / 1000))
      : null
  );
</script>

<article class="artifact-card">
  <div class="artifact-content">
    <div class="caption muted row"><Icon name="file" size={14} />{output.kind}</div>
    <h2>{output.title}</h2>
    {#if output.content}<div class="artifact-preview" class:reading>
        <FormattedText text={reading ? output.content : output.content.slice(0, 300)} />
      </div>{/if}
    <time class="caption muted" title={formatDateTime(output.createdAt)}>{formatShortTime(output.createdAt)}</time>
  </div>
  <div class="artifact-actions row wrap">
    <button class:secondary={pendingReview} onclick={() => (reading = !reading)}
      >{reading ? 'Show less' : 'Read it'}</button
    >
    {#if output.uri && toSafeHref(output.uri)}<a
        class="secondary"
        href={toSafeHref(output.uri)!}
        target="_blank"
        rel="noreferrer">Open source</a
      >{/if}
    <button class="secondary" onclick={onReply}>Ask for changes</button>
    {#if task}{#if onInspect}<button class="text-button" onclick={() => onInspect?.(task.id)}>Inspect work</button>{:else}<a href={`#/tasks/${task.id}`}>Inspect work</a>{/if}{/if}
  </div>
  {#if task}<ReviewPanel {task} onDone={onChanged} />{/if}
</article>
{#if duration !== null || cost !== undefined}<div class="caption muted">
    {duration !== null
      ? `Done in ${Math.floor(duration / 60)} min ${duration % 60} s`
      : ''}{cost !== undefined
      ? `${duration !== null ? ' · ' : ''}run cost $${cost.toFixed(2)}`
      : ''}
  </div>{/if}
