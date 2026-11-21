import type { Conversation, Project } from './api';

// One short line that tells endeavors with the same name apart:
// "Finance reporting · Closed · Nov 14". Open endeavors skip the status word.
export function endeavorDetails(
  conversation: Pick<Conversation, 'createdAt' | 'projectId' | 'state'>,
  projects: Pick<Project, 'id' | 'name'>[],
  now = new Date()
): string {
  const created = new Date(conversation.createdAt);
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(created.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
  }).format(created);
  const project = projects.find((candidate) => candidate.id === conversation.projectId)?.name;
  return [project, conversation.state === 'closed' ? 'Closed' : null, date].filter(Boolean).join(' · ');
}
