export { when, shortTime } from './time-display.svelte';
export function toLimit(value: string): number | undefined {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
export const CONTEXT_LABELS = {
  instructions:
    'How an agent should behave, set by people. Example: "Investigate billing issues and cite your sources."',
  knowledge:
    'Reference material people attach or connect. Example: billing documentation. Its owners keep the original.',
  history: 'The messages in a conversation. Agents see the part they are allowed to.',
  notes:
    'What an agent wrote down for later. Example: "Yesterday\'s check ruled out the payment gateway." Notes can be wrong, and they aren\'t approved facts.'
};
