export interface InlineText {
  kind: 'text' | 'code' | 'strong' | 'em' | 'mention' | 'you' | 'link';
  text: string;
  href?: string;
}
export interface MessageBlock {
  kind: 'paragraph' | 'heading' | 'quote' | 'code' | 'list';
  items: InlineText[][];
  ordered?: boolean;
}
export function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
// Keep user text as text. Svelte escapes it when rendering; no HTML is accepted.
export function formatMessage(
  text: string,
  names: { name: string; you?: boolean }[] = []
): MessageBlock[] {
  const sorted = [...names].sort((a, b) => b.name.length - a.name.length);
  const inline = (line: string): InlineText[] => {
    const tokens: InlineText[] = [];
    const plain = (part: string) => {
      let buffer = '';
      let i = 0;
      while (i < part.length) {
        const mention =
          part[i] === '@' &&
          sorted.find(
            (n) =>
              part.slice(i + 1, i + 1 + n.name.length).toLowerCase() === n.name.toLowerCase() &&
              !/[\p{L}\p{N}_]/u.test(part[i + 1 + n.name.length] ?? '')
          );
        if (mention) {
          if (buffer) tokens.push({ kind: 'text', text: buffer });
          buffer = '';
          tokens.push({
            kind: mention.you ? 'you' : 'mention',
            text: part.slice(i, i + mention.name.length + 1)
          });
          i += mention.name.length + 1;
        } else {
          buffer += part[i];
          i++;
        }
      }
      if (buffer) tokens.push({ kind: 'text', text: buffer });
    };
    let last = 0;
    for (const match of line.matchAll(/(`[^`]+`|\[[^\]]+\]\([^\s)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
      plain(line.slice(last, match.index));
      const token = match[0];
      if (token.startsWith('`')) tokens.push({ kind: 'code', text: token.slice(1, -1) });
      else if (token.startsWith('[')) {
        const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
        const href = safeLink(parts[2]);
        tokens.push(href ? { kind: 'link', text: parts[1], href } : { kind: 'text', text: token });
      } else if (token.startsWith('**')) tokens.push({ kind: 'strong', text: token.slice(2, -2) });
      else tokens.push({ kind: 'em', text: token.slice(1, -1) });
      last = match.index! + token.length;
    }
    plain(line.slice(last));
    return tokens;
  };
  const blocks: MessageBlock[] = [];
  let code = false;
  let buffer: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (code) {
        blocks.push({ kind: 'code', items: [[{ kind: 'text', text: buffer.join('\n') }]] });
        buffer = [];
      }
      code = !code;
      continue;
    }
    if (code) {
      buffer.push(line);
      continue;
    }
    const item = /^(?:[-*] |\d+\. )(.+)/.exec(line);
    if (item) {
      const ordered = /^\d/.test(line);
      const previous = blocks.at(-1);
      if (previous?.kind === 'list' && previous.ordered === ordered)
        previous.items.push(inline(item[1]));
      else blocks.push({ kind: 'list', ordered, items: [inline(item[1])] });
      continue;
    }
    const heading = /^(#{1,3}) (.+)/.exec(line);
    blocks.push({
      kind: heading ? 'heading' : line.startsWith('> ') ? 'quote' : 'paragraph',
      items: [inline(heading ? heading[2] : line.startsWith('> ') ? line.slice(2) : line)]
    });
  }
  if (code) blocks.push({ kind: 'code', items: [[{ kind: 'text', text: buffer.join('\n') }]] });
  return blocks;
}
