<script lang="ts">
  import { formatMessage, type InlineText } from './message-format';
  let { text, names = [] }: { text: string; names?: { name: string; you?: boolean }[] } = $props();
  let blocks = $derived(formatMessage(text, names));
</script>

{#snippet inline(tokens: InlineText[])}
  {#each tokens as token, i (i)}
    {#if token.kind === 'strong'}<strong>{token.text}</strong>
    {:else if token.kind === 'em'}<em>{token.text}</em>
    {:else if token.kind === 'code'}<code>{token.text}</code>
    {:else if token.kind === 'link'}<a href={token.href} target="_blank" rel="noreferrer"
        >{token.text}</a
      >
    {:else if token.kind === 'mention' || token.kind === 'you'}<mark
        class={token.kind === 'you' ? 'mention-you' : 'mention'}>{token.text}</mark
      >
    {:else}{token.text}{/if}
  {/each}
{/snippet}
{#each blocks as block, i (i)}
  {#if block.kind === 'heading'}<h3>{@render inline(block.items[0])}</h3>
  {:else if block.kind === 'quote'}<blockquote>{@render inline(block.items[0])}</blockquote>
  {:else if block.kind === 'code'}<pre><code>{block.items[0][0].text}</code></pre>
  {:else if block.kind === 'list'}
    {#if block.ordered}<ol>
        {#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
      </ol>
    {:else}<ul>
        {#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
      </ul>{/if}
  {:else if block.items[0].length}<p>{@render inline(block.items[0])}</p>{:else}<br />{/if}
{/each}
