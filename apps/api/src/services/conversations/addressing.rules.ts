import { ParticipantRef } from '../../shared/types';

// Which agents a message is addressed to, using the v1 response rules: the agents it mentions,
// plus the author of the message it replies to if that was an agent. Only current members
// count, and an agent is never addressed by its own message. A message that addresses nobody
// is saved but starts no work.
export function addressedAgentIds(input: {
  mentions: ParticipantRef[];
  repliedToAuthor: ParticipantRef | null;
  memberAgentIds: ReadonlySet<string>;
  authorAgentId: string | null;
}): string[] {
  const candidates = [...input.mentions, ...(input.repliedToAuthor ? [input.repliedToAuthor] : [])];
  const ids = candidates
    .filter((participant) => participant.type === 'agent')
    .map((participant) => participant.id)
    .filter((id) => input.memberAgentIds.has(id) && id !== input.authorAgentId);
  return [...new Set(ids)];
}
