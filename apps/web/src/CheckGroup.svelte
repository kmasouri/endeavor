<script lang="ts" generics="T extends string">
  let {
    options,
    selected,
    onChange
  }: {
    options: { value: T; label: string; description?: string }[];
    selected: T[];
    onChange: (selected: T[]) => void;
  } = $props();
</script>

{#if options.length === 0}
  <span class="muted">None yet.</span>
{:else}
  <div class="stack tight">
    {#each options as option (option.value)}
      <label class="check">
        <input
          type="checkbox"
          checked={selected.includes(option.value)}
          onchange={(event) =>
            onChange(
              event.currentTarget.checked
                ? [...selected, option.value]
                : selected.filter((value) => value !== option.value)
            )}
        />

        <span>
          {#if option.description !== undefined}
            <strong>{option.label}</strong>
            <span class="muted">{option.description}</span>
          {:else}{option.label}{/if}
        </span>
      </label>
    {/each}
  </div>
{/if}
