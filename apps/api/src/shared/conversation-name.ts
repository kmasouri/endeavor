export const MAX_CONVERSATION_NAME_LENGTH = 64;

// Conversation names are stored without the decorative # used by navigation.
export function canonicalConversationName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
