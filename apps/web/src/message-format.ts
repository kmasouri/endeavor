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
interface MentionName {
  name: string;
  you?: boolean;
}

// Consume the whole longest name before looking for another tag. Email addresses are not tags.
export function findTextMentions<T extends { name: string }>(text: string, names: T[]) {
  const sorted = [...names]
    .filter((entry) => entry.name)
    .sort((a, b) => b.name.length - a.name.length);
  const matches: { entry: T; start: number; end: number }[] = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '@' || WORD_CHAR.test(text[start - 1] ?? '') || text[start - 1] === '@')
      continue;
    const entry = findMentionAt(text, start + 1, sorted);
    if (!entry) continue;
    const end = start + entry.name.length + 1;
    matches.push({ entry, start, end });
    start = end - 1;
  }
  return matches;
}

const MARKDOWN_TOKEN = /(`[^`]+`|\[[^\]]+\]\([^\s)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<>"`]+/i;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const BRACKET_PAIRS = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}']
];

export function toSafeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Keep user text as text. Svelte escapes it when rendering; no HTML is accepted.
export function formatMessage(text: string, names: MentionName[] = []): MessageBlock[] {
  // Longest names first, so "Ana Lopez" wins over "Ana".
  const mentionNames = [...names].sort((a, b) => b.name.length - a.name.length);
  const parseLine = (line: string) => parseInline(line, mentionNames);
  const blocks: MessageBlock[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        blocks.push(buildCodeBlock(codeLines));
        codeLines = [];
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    const listItem = /^(?:[-*] |\d+\. )(.+)/.exec(line);
    if (listItem) {
      const ordered = /^\d/.test(line);
      const previous = blocks.at(-1);
      if (previous?.kind === 'list' && previous.ordered === ordered) {
        previous.items.push(parseLine(listItem[1]));
      } else {
        blocks.push({ kind: 'list', ordered, items: [parseLine(listItem[1])] });
      }
      continue;
    }
    const heading = /^(#{1,3}) (.+)/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', items: [parseLine(heading[2])] });
    } else if (line.startsWith('> ')) {
      blocks.push({ kind: 'quote', items: [parseLine(line.slice(2))] });
    } else {
      blocks.push({ kind: 'paragraph', items: [parseLine(line)] });
    }
  }
  // An unclosed code block runs to the end of the message.
  if (inCodeBlock) {
    blocks.push(buildCodeBlock(codeLines));
  }
  return blocks;
}

// Reply context stays one line and shows the words rather than Markdown markers.
export function buildMessagePreview(text: string): string {
  return formatMessage(text)
    .flatMap((block) => block.items.map((item) => item.map((token) => token.text).join('')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCodeBlock(lines: string[]): MessageBlock {
  return { kind: 'code', items: [[{ kind: 'text', text: lines.join('\n') }]] };
}

// Splits one line into Markdown tokens (code, links, bold, italic) and the plain text between.
function parseInline(line: string, mentionNames: MentionName[]): InlineText[] {
  const tokens: InlineText[] = [];
  let plainStart = 0;
  for (const match of line.matchAll(MARKDOWN_TOKEN)) {
    tokens.push(...parsePlainText(line.slice(plainStart, match.index), mentionNames));
    tokens.push(parseMarkdownToken(match[0]));
    plainStart = match.index + match[0].length;
  }
  tokens.push(...parsePlainText(line.slice(plainStart), mentionNames));
  return tokens;
}

function parseMarkdownToken(token: string): InlineText {
  if (token.startsWith('`')) {
    return { kind: 'code', text: token.slice(1, -1) };
  }
  if (token.startsWith('[')) {
    const [, label, target] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
    const href = toSafeHref(target);
    return href ? { kind: 'link', text: label, href } : { kind: 'text', text: token };
  }
  if (token.startsWith('**')) {
    return { kind: 'strong', text: token.slice(2, -2) };
  }
  return { kind: 'em', text: token.slice(1, -1) };
}

// Finds bare URLs and @mentions in text that has no Markdown. Everything else stays text.
function parsePlainText(text: string, mentionNames: MentionName[]): InlineText[] {
  const tokens: InlineText[] = [];
  let pendingText = '';
  const flushText = () => {
    if (pendingText) {
      tokens.push({ kind: 'text', text: pendingText });
      pendingText = '';
    }
  };
  const mentions = new Map(
    findTextMentions(text, mentionNames).map((match) => [match.start, match.entry])
  );
  let index = 0;
  while (index < text.length) {
    const startsWord = index === 0 || !WORD_CHAR.test(text[index - 1]);
    const url = startsWord ? BARE_URL.exec(text.slice(index))?.[0] : undefined;
    if (url) {
      const label = trimLinkLabel(url);
      const href = toSafeHref(/^www\./i.test(label) ? `https://${label}` : label);
      if (href) {
        flushText();
        tokens.push({ kind: 'link', text: label, href });
        index += label.length;
        continue;
      }
    }
    const mention = mentions.get(index);
    if (mention) {
      flushText();
      const length = mention.name.length + 1;
      tokens.push({
        kind: mention.you ? 'you' : 'mention',
        text: text.slice(index, index + length)
      });
      index += length;
      continue;
    }
    pendingText += text[index];
    index++;
  }
  flushText();
  return tokens;
}

// Keeps sentence punctuation outside links, but keeps balanced URL brackets, as in
// https://en.wikipedia.org/wiki/Mercury_(planet).
function trimLinkLabel(url: string): string {
  let label = url;
  let previous = '';
  while (label !== previous) {
    previous = label;
    label = label.replace(/[.,!?;:]+$/, '');
    for (const [open, close] of BRACKET_PAIRS) {
      while (label.endsWith(close) && countOf(label, close) > countOf(label, open)) {
        label = label.slice(0, -1);
      }
    }
  }
  return label;
}

function countOf(text: string, char: string): number {
  return text.split(char).length - 1;
}

// The mention name that starts at this index and ends at a word boundary, if any.
function findMentionAt<T extends { name: string }>(
  text: string,
  index: number,
  mentionNames: T[]
): T | undefined {
  return mentionNames.find(
    (entry) =>
      text.slice(index, index + entry.name.length).toLowerCase() === entry.name.toLowerCase() &&
      !WORD_CHAR.test(text[index + entry.name.length] ?? '')
  );
}
