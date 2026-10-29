<script lang="ts">
  import artwork from './brand.txt?raw';

  // Preserve the README's ASCII artwork, including its spaces and punctuation.
  const lines = artwork.trimEnd().split('\n');
  const width = Math.max(...lines.map((line) => line.length)) * 7.2;
  const height = lines.length * 12 + 4;
</script>

<svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <g fill="currentColor" font-family="'Courier New', monospace" font-size="12" font-weight="400">
    {#each lines as line, i (i)}
      <text style="white-space: pre" x="0" y={12 + i * 12}>{line}</text>
    {/each}
  </g>
</svg>
